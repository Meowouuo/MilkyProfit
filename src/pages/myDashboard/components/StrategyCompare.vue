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

import type { CalculatorWithStrategies, StrategyResult } from "../utils/fourStrategies"
import type Calculator from "@/calculator"
import { ArrowDown, ArrowUp } from "@element-plus/icons-vue"
import { calculateAllFourStrategies } from "../utils/fourStrategies"

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
  // 物品列和动作列需要合并：每 4 行合并为 1 个单元格
  if (column.property === "name" || column.property === "project") {
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
  /** 策略名称 */
  strategyName: string
  /** 策略计算结果 */
  strategy: StrategyResult
  /** 是否为该组的最优策略 */
  isBest: boolean
}

const flatTableData = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = []
  for (const item of strategyList.value) {
    // 找出当前 Calculator 中日利润最高的策略
    const bestPD = Math.max(...item.strategies.map(s => s.profitPD))

    for (const strategy of item.strategies) {
      rows.push({
        name: item.name,
        project: item.project,
        strategyName: strategy.name,
        strategy,
        isBest: strategy.profitPD === bestPD && bestPD > 0
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
        <!-- 物品列：每 4 行合并显示 -->
        <el-table-column
          prop="name"
          :label="t('物品')"
          width="140"
          fixed="left"
        />

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
