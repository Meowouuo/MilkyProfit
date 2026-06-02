<script lang="ts" setup>
/**
 * @file StrategyCompare.vue
 * @description 四向买卖策略对比组件
 *
 * 对当前排行榜中的每个物品-动作组合，展示四种买卖策略的利润对比：
 *   左买左卖、左买右卖、右买右卖、右买左卖
 *
 * 每种策略展示四项指标：
 *   - 日利润（profitPD）
 *   - 小时利润（profitPH）
 *   - 单次利润（profitPP）
 *   - 利润率（profitRate）
 *
 * 最高利润策略用绿色高亮，方便快速识别最优方案。
 */

import type { CalculatorWithStrategies, PriceType, StrategyResult } from "../utils/fourStrategies"
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { ArrowDown, ArrowUp, Search } from "@element-plus/icons-vue"
import { WorkflowCalculator } from "@/calculator/workflow"
import ActionDetail from "@/pages/dashboard/components/ActionDetail.vue"
import { calculateAllFourStrategies, getIngredientPrice, getProductPrice } from "../utils/fourStrategies"

// =============================================
// #region Props 定义
// =============================================

/**
 * 组件属性
 * - data: Calculator 列表，通常来自排行榜当前页数据
 */
const props = defineProps<{
  /** 排行榜中的 Calculator 列表 */
  data: Calculator[]
}>()

// #endregion

// =============================================
// #region 国际化
// =============================================

/** 国际化 t 函数 */
const { t } = useI18n()

// #endregion

// =============================================
// #region 策略计算
// =============================================

/**
 * 带四种策略结果的 Calculator 列表
 * 依赖 props.data，数据变化时自动重算
 */
const strategyList = computed<CalculatorWithStrategies[]>(() => {
  if (!props.data || props.data.length === 0) return []
  return calculateAllFourStrategies(props.data)
})

// #endregion

// =============================================
// #region 策略名称映射（国际化）
// =============================================

/** 四种策略名称的国际化 key */
const STRATEGY_LABELS: Record<string, string> = {
  左买左卖: t("左买左卖"),
  左买右卖: t("左买右卖"),
  右买右卖: t("右买右卖"),
  右买左卖: t("右买左卖")
}

// #endregion

// =============================================
// #region 展开/折叠状态
// =============================================

/** 策略对比面板是否展开 */
const expanded = ref(true)

/** 切换展开/折叠状态 */
function toggleExpand() {
  expanded.value = !expanded.value
}

// #endregion

// =============================================
// #region 详情弹窗
// =============================================

/** 详情弹窗可见性 */
const detailVisible = ref(false)

/** 当前选中的 Calculator（用于详情展示） */
const currentDetailRow = ref<Calculator>()

/**
 * 对单个 Calculator 实例，按指定买卖方向重新填入价格缓存，并重新 run()
 *
 * 关键：handlePrice() 中 type 参数仅影响手动价格查找，市场价始终取
 * item.marketPrice。因此必须在调用 handlePrice 前，将每个 item.marketPrice
 * 覆盖为正确的 ask/bid 方向价格（复用 fourStrategies 中的 getIngredientPrice
 * / getProductPrice，确保与策略利润计算逻辑一致）。
 *
 * @param calc      Calculator 实例
 * @param buyType   原料定价方向：ask = 左价（ASK），bid = 右价（BID）
 * @param sellType  产物定价方向：ask = 左价（ASK），bid = 右价（BID）
 */
function applyStrategyPriceToCalc(calc: Calculator, buyType: PriceType, sellType: PriceType) {
  const c = calc as any

  // 1. 重建 ingredientListWithPrice（先覆盖 marketPrice 再调 handlePrice）
  //    关键：handlePrice 中 type 仅影响手动价格，市场价取 item.marketPrice
  //    因此必须先用 getIngredientPrice 覆盖 marketPrice 为正确的 ask/bid 价
  const ingredientList = calc.ingredientList.map((item, i) => {
    const config = calc.ingredientPriceConfigList[i]
    const price = getIngredientPrice(item, config, buyType)
    return {
      ...item,
      marketPrice: price,
      price,
      countPH: item.count * calc.consumePH,
      counterCountPH: item.counterCount ? item.counterCount * calc.consumePH : undefined
    }
  })
  c._ingredientListWithPrice = calc.handlePrice(ingredientList, calc.ingredientPriceConfigList, buyType)

  // 2. 重建 productListWithPrice（先覆盖 marketPrice 再调 handlePrice）
  const productList = calc.productList.map((item, i) => {
    const config = calc.productPriceConfigList[i]
    const price = getProductPrice(item, config, sellType)
    return {
      ...item,
      marketPrice: price,
      price,
      countPH: item.count * calc.gainPH * ((item as any).rate || 1),
      counterCountPH: item.counterCount ? item.counterCount * calc.gainPH * ((item as any).rate || 1) : undefined
    }
  })
  c._productListWithPrice = calc.handlePrice(productList, calc.productPriceConfigList, sellType)

  // 3. 重新 run()，确保 result.costPH / incomePH 等字段与新价格一致
  calc.run()
}

/**
 * 对 Calculator（及 WorkflowCalculator 的子链）按策略方向重新计算价格缓存
 *
 * @param calc      Calculator 实例（可能是 WorkflowCalculator）
 * @param buyType   原料定价方向
 * @param sellType  产物定价方向
 */
function applyStrategyPrice(calc: Calculator, buyType: PriceType, sellType: PriceType) {
  if (calc instanceof WorkflowCalculator) {
    // 多步动作：先对每个子计算器重算，再对 WorkflowCalculator 本体重算
    const subCalcs: Calculator[] = (calc as any).calculatorList.flat()
    for (const sub of subCalcs) {
      applyStrategyPriceToCalc(sub, buyType, sellType)
    }
    // WorkflowCalculator 通过 _ingredientPreprocess / _productPreprocess 缓存子计算器的聚合结果，
    // 子计算器价格已变，必须清除这两个缓存，让它们重新从子计算器聚合
    const wf = calc as any
    wf._ingredientPreprocess = undefined
    wf._productPreprocess = undefined
    wf._resultList = undefined
    wf._workMultiplier = undefined
    calc.run()
  } else {
    applyStrategyPriceToCalc(calc, buyType, sellType)
  }
}

/**
 * 清除 Calculator 的价格缓存（恢复为默认的 ask/bid 硬编码状态）
 *
 * @param calc Calculator 实例
 */
function clearPriceCache(calc: Calculator) {
  // 清除当前 Calculator 本身的价格缓存
  ;(calc as any)._ingredientListWithPrice = undefined
  ;(calc as any)._productListWithPrice = undefined

  // 若为多步 WorkflowCalculator，还需清除每个子计算器和聚合缓存
  if (calc instanceof WorkflowCalculator) {
    const wf = calc as any
    wf._ingredientPreprocess = undefined
    wf._productPreprocess = undefined
    wf._resultList = undefined
    wf._workMultiplier = undefined
    const subCalcs: Calculator[] = (calc as any).calculatorList.flat()
    for (const sub of subCalcs) {
      ;(sub as any)._ingredientListWithPrice = undefined
      ;(sub as any)._productListWithPrice = undefined
    }
    // 重新 run 以恢复默认 result
    for (const sub of subCalcs) sub.run()
    calc.run()
  } else {
    calc.run()
  }
}

/**
 * 打开详情弹窗
 *
 * 打开前按当前行的策略 buyType/sellType，直接重写 Calculator 的
 * ingredientListWithPrice / productListWithPrice 缓存并重新 run()，
 * 使 ActionDetail 展示当前策略对应的原料价格与产物价格。
 * 弹窗关闭后通过 watch 清除缓存，恢复默认状态，避免污染排行榜数据。
 *
 * @param row 当前行的扁平数据（包含 calculator 实例和策略买卖方向）
 */
function showDetail(row: FlatRow) {
  // 按该策略的买卖方向重写价格缓存
  applyStrategyPrice(row.calculator, row.strategy.buyType, row.strategy.sellType)
  currentDetailRow.value = row.calculator
  detailVisible.value = true
}

/**
 * 监听弹窗关闭事件
 * 弹窗关闭后清除价格缓存，让 Calculator 恢复默认的 ask/bid 状态，
 * 避免四向策略表格数据受污染。
 */
watch(detailVisible, (visible) => {
  if (!visible && currentDetailRow.value) {
    clearPriceCache(currentDetailRow.value)
  }
})

// #endregion

// =============================================
// #region 表格行合并逻辑
// =============================================

/**
 * el-table 的 span-method 回调
 * 每个 Calculator 对应 4 行（四种策略），物品列和动作列合并显示
 *
 * @param column 当前列对象
 * @param rowIndex 行索引（扁平索引）
 * @returns [rowspan, colspan]
 */
function tableSpanMethod({ column, rowIndex }: any): [number, number] {
  // 物品图标列、物品列、催化剂列和动作列需要合并：每 4 行合并为 1 个单元格
  if (column.property === "_icon" || column.property === "name" || column.property === "project" || column.property === "catalyst") {
    if (rowIndex % 4 === 0) {
      return [4, 1] // 合并 4 行
    }
    return [0, 0] // 隐藏其他行
  }
  return [1, 1]
}

// #endregion

// =============================================
// #region 扁平化表格数据
// =============================================

/**
 * 将 CalculatorWithStrategies[] 展开为扁平的行数据
 * 每个 Calculator 对应 4 行（四种策略）
 */
interface FlatRow {
  /** 物品名称 */
  name: string
  /** 动作类型 */
  project: string
  /** 炼金催化剂 hrid（如 catalyst_of_transmutation），非炼金动作为 undefined */
  catalyst?: string
  /** 策略名称 */
  strategyName: string
  /** 策略计算结果 */
  strategy: StrategyResult
  /** 是否为该组的最优策略 */
  isBest: boolean
  /** 对应的 Calculator 实例（用于详情展示） */
  calculator: Calculator
}

const flatTableData = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = []
  for (const item of strategyList.value) {
    // 找出当前 Calculator 中日利润最高的策略
    const bestPD = Math.max(...item.strategies.map(s => s.profitPD))
    // 只有最高利润 > 0 且 只有唯一最优时才高亮
    const bestCount = item.strategies.filter(s => s.profitPD === bestPD).length
    const hasUniqueBest = bestPD > 0 && bestCount === 1

    // 炼金类 Calculator 暴露 catalyst getter（如 TransmuteCalculator.catalyst）
    // 多步 WorkflowCalculator 代理到最后一个子计算器
    const catalyst = (item.calculator as any).catalyst

    for (const strategy of item.strategies) {
      rows.push({
        name: item.name,
        project: item.project,
        catalyst,
        strategyName: strategy.name,
        strategy,
        isBest: hasUniqueBest && strategy.profitPD === bestPD,
        calculator: item.calculator
      })
    }
  }
  return rows
})

// #endregion

// =============================================
// #region 行样式（最优策略高亮）
// =============================================

/**
 * 根据行数据返回行 class
 * @param row 当前行数据
 * @returns class 对象
 */
function tableRowClassName({ row }: { row: FlatRow }) {
  return row.isBest ? "best-row" : ""
}

// #endregion
</script>

<template>
  <!--
    四向策略对比卡片
    仅在有数据时展示
  -->
  <el-card v-if="flatTableData.length > 0" class="strategy-compare-card">
    <!-- =========================================
      卡片头部：标题 + 展开/折叠按钮
    ========================================== -->
    <template #header>
      <div class="card-header">
        <span class="card-title">
          {{ t('四向策略对比') }}
        </span>
        <el-button
          text
          size="small"
          :icon="expanded ? ArrowUp : ArrowDown"
          @click="toggleExpand"
        >
          {{ expanded ? t('收起') : t('展开') }}
        </el-button>
      </div>
    </template>

    <!-- =========================================
      策略对比表格
    ========================================== -->
    <div v-show="expanded">
      <el-table
        :data="flatTableData"
        :span-method="tableSpanMethod"
        :row-class-name="tableRowClassName"
        border
        stripe
        size="small"
      >
        <!-- 物品图标列：每 4 行合并显示，复用原版 ItemIcon -->
        <el-table-column
          prop="_icon"
          width="54"
          align="center"
          fixed="left"
        >
          <template #default="{ row }">
            <ItemIcon :hrid="row.calculator.hrid" />
          </template>
        </el-table-column>

        <!-- 物品列：每 4 行合并显示 -->
        <el-table-column
          prop="name"
          :label="t('物品')"
          width="140"
        />

        <!-- 催化剂图标列（炼金动作）：每 4 行合并显示 -->
        <el-table-column
          prop="catalyst"
          width="54"
          align="center"
        >
          <template #default="{ row }">
            <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
          </template>
        </el-table-column>

        <!-- 动作列：每 4 行合并显示 -->
        <el-table-column
          prop="project"
          :label="t('动作')"
          width="80"
          align="center"
        />

        <!-- 策略名称列 -->
        <el-table-column
          prop="strategyName"
          :label="t('策略')"
          width="100"
          align="center"
        >
          <template #default="{ row }">
            {{ STRATEGY_LABELS[row.strategyName] || row.strategyName }}
          </template>
        </el-table-column>

        <!-- 日利润列 -->
        <el-table-column
          :label="t('利润 / 天')"
          align="right"
          min-width="120"
        >
          <template #default="{ row }">
            {{ row.strategy.profitPDFormat }}
          </template>
        </el-table-column>

        <!-- 小时利润列 -->
        <el-table-column
          :label="t('利润 / h')"
          align="right"
          min-width="110"
        >
          <template #default="{ row }">
            {{ row.strategy.profitPHFormat }}
          </template>
        </el-table-column>

        <!-- 单次利润列 -->
        <el-table-column
          :label="t('利润 / 次')"
          align="right"
          min-width="110"
        >
          <template #default="{ row }">
            {{ row.strategy.profitPPFormat }}
          </template>
        </el-table-column>

        <!-- 利润率列 -->
        <el-table-column
          :label="t('利润率')"
          align="right"
          min-width="100"
        >
          <template #default="{ row }">
            {{ row.strategy.profitRateFormat }}
          </template>
        </el-table-column>

        <!-- 详情列 -->
        <el-table-column
          :label="t('详情')"
          width="80"
          align="center"
          fixed="right"
        >
          <template #default="{ row }">
            <el-link
              type="primary"
              :icon="Search"
              :underline="false"
              @click="showDetail(row)"
            >
              {{ t('详情') }}
            </el-link>
          </template>
        </el-table-column>
      </el-table>

      <!-- 图例说明 -->
      <div class="legend">
        <span class="legend-item best-legend">
          ■ {{ t('最优策略') }}
        </span>
        <span class="legend-item">
          {{ t('说明：四种策略分别采用不同的买卖价格组合，选出日利润最高的策略作为最优方案') }}
        </span>
      </div>
    </div>

    <!-- 详情弹窗：复用原版 ActionDetail 组件 -->
    <ActionDetail v-model="detailVisible" :data="currentDetailRow" />
  </el-card>
</template>

<style lang="scss" scoped>
/**
 * 策略对比卡片整体样式
 */
.strategy-compare-card {
  margin-top: 16px;

  /* 卡片头部布局：标题在左，按钮在右 */
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .card-title {
      font-weight: 600;
      font-size: 15px;
    }
  }
}

/**
 * 最优策略行高亮：绿色背景
 */
:deep(.best-row) {
  background-color: #f0f9eb !important;

  td {
    font-weight: 600;
    color: #67c23a;
  }
}

/**
 * 表格底部图例说明
 */
.legend {
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
  display: flex;
  gap: 16px;
  align-items: center;

  .legend-item {
    display: inline-flex;
    align-items: center;
  }

  /* 最优策略图例色块 */
  .best-legend {
    color: #67c23a;
    font-weight: 600;
  }
}
</style>
