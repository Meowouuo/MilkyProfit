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
function calcIncome(cal: Calculator, priceType: PriceType): number {
  const pricedList = cal.handlePrice(cal.productList, cal.productPriceConfigList, priceType)
  return pricedList.reduce((acc, item) => {
    if (item.price <= 0) return acc
    const rate = (item as Product).rate ?? 1
    return acc + item.count * rate * item.price
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
   * 核心思路（与 Calculator.run() 一致——复用现有算法，仅切换价格类型）：
   *
   *   单步动作：
   *     costPH = Σ原料.count × price × consumePH
   *     incomePH = Σ产物.count × rate × price × gainPH × sellTaxFactor
   *
   *   多步动作（WorkflowCalculator）：
   *     遍历每个子计算器的 ingredientList / productList，
   *     分别按当前的 buyType / sellType 查找价格，
   *     再乘以各子计算器的频率参数和 workMultiplier 倍率后累加。
   *     —— 这与 WorkflowCalculator.run() 中
   *        Σ resultList.costPH × workMultiplier 的算法一致。
   */

  const isWorkflow = calculator.className === "WorkflowCalculator"
  const actionsPH = calculator.actionsPH
  const sellTaxFactor = calculator.sellTaxFactor
  const invalid = actionsPH <= 0 || !Number.isFinite(actionsPH)

  return STRATEGIES.map(({ name, buyType, sellType }) => {
    if (invalid) {
      return makeEmptyResult(name, buyType, sellType)
    }

    let costPH: number
    let incomePH: number

    if (isWorkflow) {
      // ——— 多步动作：遍历所有子计算器，逐个累加 ———
      // 子计算器的 handlePrice() 已内置了中间步骤 immutable:true/price:0 的配置，
      // 确保只有第一步的原料和最后一步的产物使用真实市场价格。
      const cals: Calculator[] = (calculator as any).calculatorList.flat()
      const multipliers: number[] = (calculator as any).workMultiplier.flat()

      costPH = 0
      incomePH = 0

      for (let i = 0; i < cals.length; i++) {
        const cal = cals[i]
        const mult = multipliers[i] || 0

        if (mult <= 0) continue

        // 子计算器的原料成本（单次动作），乘以该阶段频率和倍率
        costPH += calcCost(cal, buyType) * cal.consumePH * mult

        // 子计算器的产物收入（单次成功动作），乘以增益频率、倍率和税率
        incomePH += calcIncome(cal, sellType) * cal.gainPH * mult * sellTaxFactor
      }
    } else {
      // ——— 单步动作：直接取原料/产物列表 ———
      const consumePH = calculator.consumePH
      const gainPH = calculator.gainPH

      costPH = calcCost(calculator, buyType) * consumePH
      incomePH = calcIncome(calculator, sellType) * gainPH * sellTaxFactor
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
