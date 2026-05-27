/**
 * @file fourStrategies.ts
 * @description 四种买卖策略利润计算工具
 *
 * 策略对照：
 *   左价（ASK）= 卖方挂单价 → 买入成本
 *   右价（BID）= 买方挂单价 → 卖出收入
 *
 *   - 左买左卖：买 ASK / 卖 ASK
 *   - 左买右卖：买 ASK / 卖 BID（默认策略，应与原始 Calculator 完全一致）
 *   - 右买右卖：买 BID / 卖 BID
 *   - 右买左卖：买 BID / 卖 ASK
 *
 * 定价逻辑（复用原始 Calculator 的定价体系）：
 *   1. 手动价格优先：getManualPriceOf(hrid, level).ask/.bid
 *   2. 然后原始市场价：getPriceOf(hrid, level, ASK, BID).ask/.bid
 *      （显式传 ASK/BID 绕过全局 buyStatus/sellStatus，拿到未被污染的原始价格）
 *   3. immutable 配置：多步动作中间步骤 price=0（内部流转不重复计价）
 *
 * 与原始 Calculator 的 "左买右卖" 结果可验算：
 *   Calculator 构造时 ingredientList[].marketPrice ← getPriceOf(x, buyStatus).ask
 *                   productList[].marketPrice   ← getPriceOf(x, sellStatus).bid
 *   当 buyStatus=ASK, sellStatus=BID 时，marketPrice = 原始 ask / 原始 bid，
 *   与本文件的 getItemPrice(..., "ask"/"bid") 在无手动价时结果一致。
 */

import type { Product } from "@/calculator"
import type Calculator from "@/calculator"
import { getPriceOf } from "@/common/apis/game"
import { getManualPriceOf } from "@/common/apis/price"
import * as Format from "@/common/utils/format"
import { COIN_HRID, PriceStatus } from "@/pinia/stores/game"

// =============================================
// #region 类型定义
// =============================================

/** 策略名称字面量 */
export type StrategyName = "左买左卖" | "左买右卖" | "右买右卖" | "右买左卖"

/** 价格类型（对应市场左侧 ask 或右侧 bid） */
export type PriceType = "ask" | "bid"

/**
 * 策略配置：名称 + 买卖价格类型
 */
export interface StrategyConfig {
  name: StrategyName
  /** 买入使用的价格类型（ask 或 bid） */
  buyType: PriceType
  /** 卖出使用的价格类型（ask 或 bid） */
  sellType: PriceType
}

/**
 * 单个策略的计算结果
 */
export interface StrategyResult {
  /** 策略名称 */
  name: StrategyName
  /** 买入价格类型 */
  buyType: PriceType
  /** 卖出价格类型 */
  sellType: PriceType
  /** 日利润（数值） */
  profitPD: number
  /** 小时利润（数值） */
  profitPH: number
  /** 单次利润（数值） */
  profitPP: number
  /** 利润率（小数，如 0.15 表示 15%） */
  profitRate: number
  /** 格式化后的日利润 */
  profitPDFormat: string
  /** 格式化后的小时利润 */
  profitPHFormat: string
  /** 格式化后的单次利润 */
  profitPPFormat: string
  /** 格式化后的利润率 */
  profitRateFormat: string
}

/** Calculator + 四种策略结果的组合 */
export interface CalculatorWithStrategies {
  /** 原始 Calculator 实例 */
  calculator: Calculator
  /** 物品名称 */
  name: string
  /** 动作类型 */
  project: string
  /** 四种策略计算结果 */
  strategies: StrategyResult[]
}

// #endregion

// =============================================
// #region 常量
// =============================================

/** 四种策略的固定配置 */
const STRATEGIES: StrategyConfig[] = [
  { name: "左买左卖", buyType: "ask", sellType: "ask" },
  { name: "左买右卖", buyType: "ask", sellType: "bid" },
  { name: "右买右卖", buyType: "bid", sellType: "bid" },
  { name: "右买左卖", buyType: "bid", sellType: "ask" }
]

/**
 * 利润率上限（避免成本为 0 时出现 Infinity）
 * 实际显示时通过 Format.percent 转换
 */
const MAX_PROFIT_RATE = 999

// #endregion

// =============================================
// #region 价格查询 — 核心
// =============================================

/**
 * 获取物品在指定策略组合下的真实单价
 *
 * 定价顺序（与 Calculator.handlePrice 一致）：
 *   1. 手动价格（手动价不区分 ask/bid 市场方向，只区分买价 manualType=ask 和卖价 manualType=bid）
 *   2. 原始市场价（显式传 ASK/BID 拿到真实 ask/bid，不被全局 buyStatus/sellStatus 污染）
 *
 * @param hrid 物品 hrid
 * @param level 物品等级
 * @param marketType 希望使用的原始市场价方向（"ask" 取卖方挂单价，"bid" 取买方挂单价）
 * @param manualType 手动价格查询方向（"ask" 查买入手工价，"bid" 查卖出手工价）
 * @returns 单价（可能为 0 或负数表示无有效价格）
 */
function getItemPrice(
  hrid: string,
  level: number,
  marketType: PriceType,
  manualType: "ask" | "bid"
): number {
  // 1. 手动价格优先
  const manual = getManualPriceOf(hrid, level)?.[manualType]
  if (manual?.manual && manual.manualPrice != null) {
    return manual.manualPrice
  }

  // 2. 原始市场价（ASK, BID 参数确保拿到未被全局状态污染的原始价）
  const raw = getPriceOf(hrid, level, PriceStatus.ASK, PriceStatus.BID)
  return marketType === "ask" ? raw.ask : raw.bid
}

// #endregion

// =============================================
// #region 成本 & 收入计算 — 单次动作
// =============================================

/**
 * 计算单次动作的原料总成本
 *
 * 每个原料价格 = 手动价（manualType="ask"）|| 原始市场价（按 marketType 方向）。
 * 多步动作的中间步骤：ingredientPriceConfigList 中的 immutable 配置会使对应原料被跳过。
 *
 * @param cal 子计算器（已 run）
 * @param buyType 买入价格方向（"ask" 或 "bid"）
 * @returns 单次动作的原料总成本
 */
function calcCost(cal: Calculator, buyType: PriceType): number {
  return cal.ingredientList.reduce((acc, item, idx) => {
    // 多步动作中间步骤的原料被标记为 immutable，价格恒为 0（内部流转不重复计价）
    if (cal.ingredientPriceConfigList[idx]?.immutable) return acc

    const price = getItemPrice(item.hrid, item.level ?? 0, buyType, "ask")
    return acc + (price > 0 ? item.count * price : 0)
  }, 0)
}

/**
 * 计算单次成功行动的产物总收入（税前）
 *
 * 每个产物价格 = 手动价（manualType="bid"）|| 原始市场价（按 marketType 方向）。
 * 硬币产物不计税（与 Calculator.income 逻辑一致）。
 * 多步动作的中间步骤：productPriceConfigList 中的 immutable 配置会使对应产物被跳过。
 *
 * @param cal 子计算器（已 run）
 * @param sellType 卖出价格方向（"ask" 或 "bid"）
 * @param sellTaxFactor 销售税率因子
 * @returns 单次成功行动的产物总收入（税前）
 */
function calcIncome(cal: Calculator, sellType: PriceType, sellTaxFactor: number): number {
  return cal.productList.reduce((acc, item, idx) => {
    // 多步动作中间步骤的产物价格恒为 0
    if (cal.productPriceConfigList[idx]?.immutable) return acc

    const price = getItemPrice((item as Product).hrid, (item as Product).level ?? 0, sellType, "bid")
    if (price <= 0) return acc

    const rate = (item as Product).rate ?? 1
    // 硬币不计税：先除后乘（与 Calculator.income 逻辑一致）
    const coinDivisor = (item as Product).hrid === COIN_HRID ? sellTaxFactor : 1
    return acc + item.count * rate * price / coinDivisor
  }, 0)
}

// #endregion

// =============================================
// #region 核心导出函数
// =============================================

/**
 * 计算单个 Calculator 的四种策略利润
 *
 * 单步 & 多步统一逻辑：
 *   遍历 Calculator（或 WorkflowCalculator 的每个子计算器），
 *   对每种策略用不同的 buyType/sellType 查价计算成本与收入，
 *   再乘以频率参数（consumePH/gainPH/workMultiplier）和税率后累加。
 *
 * "左买右卖" 策略（ask 买/bid 卖）的计算结果应与原始 Calculator 完全一致，
 * 可用原始看板做验算。
 *
 * @param calculator 已执行 run() 的 Calculator 实例
 * @returns 四种策略的结果数组（顺序：左买左卖 → 左买右卖 → 右买右卖 → 右买左卖）
 */
export function calculateFourStrategies(calculator: Calculator): StrategyResult[] {
  const isWorkflow = calculator.className === "WorkflowCalculator"
  const actionsPH = calculator.actionsPH
  const sellTaxFactor = calculator.sellTaxFactor
  const invalid = actionsPH <= 0 || !Number.isFinite(actionsPH)

  // ——— 提取子计算器列表 + 对应倍率 ———
  interface CalcWithMult {
    cal: Calculator
    mult: number
  }
  let calcEntries: CalcWithMult[]

  if (isWorkflow) {
    const cals: Calculator[] = (calculator as any).calculatorList.flat()
    const multipliers: number[] = (calculator as any).workMultiplier.flat()
    calcEntries = cals.map((cal, i) => ({ cal, mult: multipliers[i] || 0 }))
  } else {
    calcEntries = [{ cal: calculator, mult: 1 }]
  }

  return STRATEGIES.map(({ name, buyType, sellType }) => {
    if (invalid) {
      return makeEmptyResult(name, buyType, sellType)
    }

    let costPH = 0
    let incomePH = 0

    for (const { cal, mult } of calcEntries) {
      if (mult <= 0) continue

      // 单次动作的原料成本 × 消耗频率 × 步骤倍率
      costPH += calcCost(cal, buyType) * cal.consumePH * mult

      // 单次成功行动的产物收入（税前） × 产出频率 × 步骤倍率 × 税率
      incomePH += calcIncome(cal, sellType, sellTaxFactor) * cal.gainPH * mult * sellTaxFactor
    }

    // 利润/h = 收入/h − 成本/h
    const profitPH = incomePH - costPH

    // 利润/天 = 利润/h × 24
    const profitPD = profitPH * 24

    // 利润/次 = 利润/h ÷ 每小时动作次数
    const profitPP = profitPH / actionsPH

    // 利润率（按小时成本算）
    const profitRate = costPH > 0 ? profitPH / costPH : MAX_PROFIT_RATE

    return {
      name,
      buyType,
      sellType,
      profitPD,
      profitPH,
      profitPP,
      profitRate,
      profitPDFormat: Format.money(profitPD),
      profitPHFormat: Format.money(profitPH),
      profitPPFormat: Format.money(profitPP),
      profitRateFormat: Format.percent(Math.min(profitRate, MAX_PROFIT_RATE))
    }
  })
}

/**
 * 对多个 Calculator 批量计算四种策略
 * @param calculatorList Calculator 列表（已 run）
 * @returns 带策略结果的 CalculatorWithStrategies 数组
 */
export function calculateAllFourStrategies(calculatorList: Calculator[]): CalculatorWithStrategies[] {
  return calculatorList.map((calculator) => {
    const strategies = calculateFourStrategies(calculator)
    return {
      calculator,
      name: calculator.result?.name ?? "",
      project: calculator.project ?? "",
      strategies
    }
  })
}

// #endregion

// =============================================
// #region 辅助函数
// =============================================

/**
 * 创建全零的占位策略结果（用于无法计算时）
 */
function makeEmptyResult(name: StrategyName, buyType: PriceType, sellType: PriceType): StrategyResult {
  return {
    name,
    buyType,
    sellType,
    profitPD: 0,
    profitPH: 0,
    profitPP: 0,
    profitRate: 0,
    profitPDFormat: "0",
    profitPHFormat: "0",
    profitPPFormat: "0",
    profitRateFormat: "0%"
  }
}

// #endregion
