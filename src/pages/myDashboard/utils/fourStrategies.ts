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
 * 定价逻辑（与 Calculator.handlePrice 完全一致）：
 *   每个原料/产物的价格由以下优先级决定：
 *   1. immutable 配置 → 强制使用 priceConfig.price（多步中间步骤，价格恒为 0）
 *   2. 手动价格（getManualPriceOf）→ 用户自定义价格优先
 *   3. item.marketPrice（Calculator 构造时已正确设置）→ 市场价 / 炼金费 / 特殊定价
 *
 * 为什么不用 getItemPrice() / getPriceOf() 重新查价？
 *   Calculator 构造时，炼金动作的硬币成本（COIN_HRID）的 marketPrice
 *   被设为 Math.max(sellPrice/5, 50)（即炼金费），而非市场硬币价格（恒为 1）。
 *   如果重新查价，会把这个特殊定价覆盖为 1，导致成本严重低估、利润虚高。
 *   因此本文件完全复用 item.marketPrice，不自行查市场价。
 *
 * 与原始 Calculator 的 "左买右卖" 结果可验算：
 *   当原始 Calculator 的 buyStatus=ASK, sellStatus=BID 时，
 *   ingredientList[].marketPrice = getPriceOf(hrid, ASK).ask（原始 ask）
 *   productList[].marketPrice   = getPriceOf(hrid, BID).bid（原始 bid）
 *   与本文件左买右卖策略使用的 item.marketPrice 在无手动价时完全一致。
 */

import type { Product } from "@/calculator"
import type Calculator from "@/calculator"
import { getManualPriceOf } from "@/common/apis/price"
import * as Format from "@/common/utils/format"
import { COIN_HRID } from "@/pinia/stores/game"

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
// #region 价格获取 — 与 Calculator.handlePrice 完全一致
// =============================================

/**
 * 获取单个原料/产物在指定策略下的单价
 *
 * 定价优先级（与 Calculator.handlePrice 完全一致）：
 *   1. immutable 配置 → 强制使用 priceConfig.price（多步中间步骤，价格恒为 0）
 *   2. 手动价格（getManualPriceOf）→ 用户自定义价格优先
 *   3. item.marketPrice（Calculator 构造时已正确设置）→ 市场价 / 炼金费 / 特殊定价
 *
 * 为什么不用 getPriceOf() 重新查价？
 *   Calculator 构造时，炼金动作的 COIN_HRID 原料 marketPrice
 *   被设为 Math.max(sellPrice/5, 50)（即炼金费），而非市场硬币价格（恒为 1）。
 *   如果重新查价，会把炼金费覆盖为 1，导致成本严重低估、利润虚高。
 *   因此本函数完全复用 item.marketPrice，不自行查市场价。
 *
 * @param item        原料或产物对象（含 marketPrice 字段）
 * @param priceConfig 对应的价格配置（含 immutable 标志）
 * @param manualType  手动价格查询方向（"ask" 查买入手工价，"bid" 查卖出手工价）
 * @returns 单价（可能是 0，表示内部流转不重复计价）
 */
function getPriceFromItem(
  item: { hrid: string, level?: number, marketPrice: number },
  priceConfig: { immutable?: boolean, price?: number } | undefined,
  manualType: "ask" | "bid"
): number {
  // 1. immutable → 强制使用 priceConfig.price（多步中间步骤恒为 0）
  if (priceConfig?.immutable) {
    return priceConfig.price ?? 0
  }

  // 2. 手动价格优先
  const manual = getManualPriceOf(item.hrid, item.level ?? 0)?.[manualType]
  if (manual?.manual && manual.manualPrice != null) {
    return manual.manualPrice
  }

  // 3. 使用 Calculator 构造时已正确设置的 marketPrice
  //    （普通物品 = 市场价，炼金硬币 = 炼金费，特殊物品 = 特殊定价）
  return item.marketPrice
}

// #endregion

// =============================================
// #region 成本 & 收入计算 — 单次动作
// =============================================

/**
 * 计算单次动作的原料总成本
 *
 * 价格获取逻辑与 Calculator.handlePrice 完全一致：
 *   immutable → 手动价 → item.marketPrice（不重新查市场价）。
 * 多步动作的中间步骤原料被标记为 immutable，价格恒为 0（内部流转不重复计价）。
 *
 * @param cal 子计算器（已 run）
 * @returns 单次动作的原料总成本
 */
function calcCost(cal: Calculator): number {
  return cal.ingredientList.reduce((acc, item, idx) => {
    const price = getPriceFromItem(item, cal.ingredientPriceConfigList[idx], "ask")
    return acc + (price > 0 ? item.count * price : 0)
  }, 0)
}

/**
 * 计算单次成功行动的产物总收入（税前）
 *
 * 价格获取逻辑与 Calculator.handlePrice 完全一致：
 *   immutable → 手动价 → item.marketPrice（不重新查市场价）。
 * 硬币产物不计税（与 Calculator.income 逻辑一致）。
 * 多步动作的中间步骤产物被标记为 immutable，价格恒为 0。
 *
 * @param cal 子计算器（已 run）
 * @param sellTaxFactor 销售税率因子
 * @returns 单次成功行动的产物总收入（税前）
 */
function calcIncome(cal: Calculator, sellTaxFactor: number): number {
  return cal.productList.reduce((acc, item, idx) => {
    const price = getPriceFromItem(item as Product, cal.productPriceConfigList[idx], "bid")
    if (price <= 0) return acc

    const rate = (item as Product).rate ?? 1
    // 硬币不计税：先除后乘（与 Calculator.income 逻辑一致）
    const coinDivisor = (item as Product).hrid === COIN_HRID ? sellTaxFactor : 1
    return acc + (item as Product).count * rate * price / coinDivisor
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
 *   对每种策略用 calcCost / calcIncome 计算成本与收入，
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
      costPH += calcCost(cal) * cal.consumePH * mult

      // 单次成功行动的产物收入（税前） × 产出频率 × 步骤倍率 × 税率
      incomePH += calcIncome(cal, sellTaxFactor) * cal.gainPH * mult * sellTaxFactor
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
