/**
 * @file fourStrategies.ts
 * @description 四种买卖策略利润计算工具
 *
 * 基于 Calculator 已计算的结果，重新以不同的买入/卖出价格组合
 * 计算四种策略的利润数据。
 *
 * 策略对照：
 *   左价（ASK）= 卖方挂单价 → 买入成本
 *   右价（BID）= 买方挂单价 → 卖出收入
 *
 *   - 左买左卖：买 ASK / 卖 ASK
 *   - 左买右卖：买 ASK / 卖 BID（当前默认策略）
 *   - 右买右卖：买 BID / 卖 BID
 *   - 右买左卖：买 BID / 卖 ASK（理论最优）
 */

import type { Product } from "@/calculator"
import type Calculator from "@/calculator"
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
// #region 辅助函数
// =============================================

/**
 * 计算原料总成本（单次动作）
 *
 * 使用 Calculator.handlePrice() 以确保：
 * - 尊重子计算器的 immutable 价格配置（多步动作中，中间步骤原料价格为 0）
 * - 正确区分 ask / bid 手动价格
 *
 * @param cal 已 run() 的子计算器实例
 * @param priceType 使用的价格类型（ask 或 bid）
 * @returns 单次动作的总原料成本
 */
function calcCost(cal: Calculator, priceType: PriceType): number {
  const pricedList = cal.handlePrice(cal.ingredientList, cal.ingredientPriceConfigList, priceType)
  return pricedList.reduce((acc, item) => {
    // 价格无效时跳过该项
    return acc + (item.price > 0 ? item.count * item.price : 0)
  }, 0)
}

/**
 * 计算产物总收入（单次成功行动，税前）
 *
 * 使用 Calculator.handlePrice() 以确保：
 * - 尊重子计算器的 immutable 价格配置（多步动作中，中间步骤产物价格为 0）
 * - 正确区分 ask / bid 手动价格
 *
 * 税率处理说明：
 *   产物在 Calculator 中统一走 sellTaxFactor 扣税，
 *   此处收入为税前值，税后扣减在 calculateFourStrategies 调用处统一乘以 sellTaxFactor。
 *
 * @param cal 已 run() 的子计算器实例
 * @param priceType 使用的价格类型（ask 或 bid）
 * @returns 单次成功行动的总收入（税前）
 */
function calcIncome(cal: Calculator, priceType: PriceType, sellTaxFactor: number): number {
  const pricedList = cal.handlePrice(cal.productList, cal.productPriceConfigList, priceType)
  return pricedList.reduce((acc, item) => {
    if (item.price <= 0) return acc
    const rate = (item as Product).rate ?? 1
    // 硬币不计税（与 Calculator.income 逻辑一致：先除后乘）
    const coinDivisor = (item as Product).hrid === COIN_HRID ? sellTaxFactor : 1
    return acc + item.count * rate * item.price / coinDivisor
  }, 0)
}

// #endregion

// =============================================
// #region 核心导出函数
// =============================================

/**
 * 计算单个 Calculator 的四种策略利润
 *
 * 核心思路：
 *   1. 从 calculator.ingredientList 获取原料数量（不受 handlePrice 影响）
 *   2. 从 calculator.productList 获取产物数量
 *   3. 对每种策略，用不同的 ask/bid 价格组合重新计算成本与收入
 *   4. 其余参数（频率、增益、税率）与 Calculator 计算结果保持一致
 *
 * @param calculator 已执行 run() 的 Calculator 实例
 * @returns 四种策略的结果数组（顺序：左买左卖 → 左买右卖 → 右买右卖 → 右买左卖）
 */
export function calculateFourStrategies(calculator: Calculator): StrategyResult[] {
  /**
   * 计算策略：
   *
   *   单步动作：
   *     直接用 handlePrice(..., buyType/sellType) 重新计算成本与收入。
   *
   *   多步动作（WorkflowCalculator）：
   *     以 resultList 中已算好的 "左买右卖"（ask 原料 / bid 产物）值为基准，
   *     该基准与原始计算器 100% 一致（可验算）。
   *     其他三种策略 = 基准值 + 价格 delta（bid⇔ask 差异）。
   *
   *     这样避免了独立重算过程中任何细微的缓存/副作用差异。
   */

  const isWorkflow = calculator.className === "WorkflowCalculator"
  const actionsPH = calculator.actionsPH
  const sellTaxFactor = calculator.sellTaxFactor
  const invalid = actionsPH <= 0 || !Number.isFinite(actionsPH)

  // ——— 多步动作：预先从 resultList 提取基准值（仅 "左买右卖" 策略，即 ask 买 bid 卖） ———
  // 每个子计算器在构造函数中已被配置了 immutable 价格，
  // resultList 中的 costPH / incomePH 即为 "左买右卖" 策略的正确结果。
  let baseResultList: any[] | null = null
  if (isWorkflow && !invalid) {
    const rawResultList = (calculator as any).resultList
    baseResultList = Array.isArray(rawResultList) ? rawResultList.flat() as any[] : null
  }

  return STRATEGIES.map(({ name, buyType, sellType }) => {
    if (invalid) {
      return makeEmptyResult(name, buyType, sellType)
    }

    let costPH: number
    let incomePH: number

    if (isWorkflow && baseResultList) {
      // ——— 多步动作：基准 + delta 策略 ———
      const cals: Calculator[] = (calculator as any).calculatorList.flat()
      // 提取每个子步骤的 workMultiplier（resultList[i].workMultiplier）
      const stepMults: number[] = baseResultList.map((r: any) => r.workMultiplier as number)

      costPH = 0
      incomePH = 0

      for (let i = 0; i < cals.length; i++) {
        const cal = cals[i]
        const ri = baseResultList[i]
        const mult = stepMults[i] || 0
        if (mult <= 0 || !ri) continue

        // 从 resultList 反推 "左买右卖" 策略下的单次动作成本与税前收入
        const origCostPerAction = ri.consumePH > 0
          ? ri.costPH / ri.consumePH
          : 0
        const origIncomePerActionPreTax = ri.gainPH > 0
          ? ri.incomePH / ri.gainPH / sellTaxFactor
          : 0

        let adjustedCost = origCostPerAction
        let adjustedIncome = origIncomePerActionPreTax

        // 当买入类型不是 "ask" 时，计算成本 delta
        if (buyType !== "ask") {
          const askCost = calcCost(cal, "ask")
          const bidCost = calcCost(cal, "bid")
          adjustedCost = origCostPerAction + (bidCost - askCost)
        }

        // 当卖出类型不是 "bid" 时，计算收入 delta
        if (sellType !== "bid") {
          const bidIncome = calcIncome(cal, "bid", sellTaxFactor)
          const askIncome = calcIncome(cal, "ask", sellTaxFactor)
          adjustedIncome = origIncomePerActionPreTax + (askIncome - bidIncome)
        }

        // 累积小时值
        costPH += adjustedCost * cal.consumePH * mult
        incomePH += adjustedIncome * cal.gainPH * mult * sellTaxFactor
      }
    } else {
      // ——— 单步动作：直接计算 ———
      const consumePH = calculator.consumePH
      const gainPH = calculator.gainPH

      costPH = calcCost(calculator, buyType) * consumePH
      incomePH = calcIncome(calculator, sellType, sellTaxFactor) * gainPH * sellTaxFactor
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
// #region   辅助函数
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
