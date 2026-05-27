<script lang="ts" setup>
/**
 * @file myDashboard/index.vue
 * @description 我的看板页面
 *
 * 本页面参照首页（/dashboard）设计，展示利润排行和收藏夹两个核心模块。
 * 与 dashboard 功能保持一致，可在此基础上做个性化扩展。
 *
 * 本页面独有功能：
 *   - 四向策略对比：在利润排行表格下方展示四种买卖组合（左买左卖、
 *     左买右卖、右买右卖、右买左卖）的日利润、小时利润、次利润、利润率，
 *     并自动高亮日利润最高的最优策略。详见 StrategyCompare.vue。
 *
 * 与 dashboard 的主要差异：
 *   - 所有 useMemory / usePagination 的 key 均改为 "myDashboard-" 前缀，
 *     确保两个页面的分页、搜索条件、税率开关等持久化状态相互独立。
 *   - 子组件仍复用 dashboard/components 目录下的公共组件，不重复拷贝。
 *   - 菜单标题改为 "我的看板"（在路由 meta.title 中配置）。
 */

import type Calculator from "@/calculator"

// ————————————————————————————————————————————————————
// 外部依赖：接口请求
// ————————————————————————————————————————————————————
import { getLeaderboardDataApi } from "@@/apis/leaderboard"

// ————————————————————————————————————————————————————
// 外部依赖：公共组件
// ————————————————————————————————————————————————————
import ItemIcon from "@@/components/ItemIcon/index.vue"

// ————————————————————————————————————————————————————
// 外部依赖：公共组合式函数
// ————————————————————————————————————————————————————
import { usePagination } from "@@/composables/usePagination"

// ————————————————————————————————————————————————————
// Element Plus 图标与组件
// ————————————————————————————————————————————————————
import { Delete, Edit, Search, Star, StarFilled, Warning } from "@element-plus/icons-vue"
import { ElMessageBox, type FormInstance, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"

// ————————————————————————————————————————————————————
// 内部依赖：接口
// ————————————————————————————————————————————————————
import { addFavoriteApi, deleteFavoriteApi, getFavoriteDataApi } from "@/common/apis/favorite"
import { getPriceOf } from "@/common/apis/game"
import { getActionConfigOf } from "@/common/apis/player"

// ————————————————————————————————————————————————————
// 内部依赖：组合式函数
// ————————————————————————————————————————————————————
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"

// ————————————————————————————————————————————————————
// 内部依赖：工具函数
// ————————————————————————————————————————————————————
import * as Format from "@/common/utils/format"

// ————————————————————————————————————————————————————
// 内部依赖：子组件（复用 dashboard/components，不重复拷贝）
// ————————————————————————————————————————————————————
import ActionConfig from "@/pages/dashboard/components/ActionConfig.vue"
import ActionDetail from "@/pages/dashboard/components/ActionDetail.vue"
import ActionPrice from "@/pages/dashboard/components/ActionPrice.vue"
import GameInfo from "@/pages/dashboard/components/GameInfo.vue"

import ManualPriceCard from "@/pages/dashboard/components/ManualPriceCard.vue"
import PriceStatusSelect from "@/pages/dashboard/components/PriceStatusSelect.vue"
// ————————————————————————————————————————————————————
// 内部依赖：Pinia 状态管理
// ————————————————————————————————————————————————————
import { useFavoriteStore } from "@/pinia/stores/favorite"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { usePriceStore } from "@/pinia/stores/price"

// ————————————————————————————————————————————————————
// 内部依赖：本页面新增组件
// ————————————————————————————————————————————————————
import StrategyCompare from "./components/StrategyCompare.vue"

// =============================================
// #region 利润排行模块（Leaderboard）
// =============================================

/** 收藏夹 store，用于在排行榜中判断收藏状态 */
const favoriteStore = useFavoriteStore()

/**
 * 利润排行分页数据
 * key 使用 "myDashboard-" 前缀，与 dashboard 页面的分页状态相互独立
 */
const {
  paginationData: paginationDataLD,
  handleCurrentChange: handleCurrentChangeLD,
  handleSizeChange: handleSizeChangeLD
} = usePagination({}, "myDashboard-leaderboard-pagination")

/** 利润排行列表数据 */
const leaderboardData = ref<Calculator[]>([])

/** 利润排行搜索表单 ref，用于表单校验 */
const ldSearchFormRef = ref<FormInstance | null>(null)

/**
 * 利润排行搜索条件（持久化到 localStorage）
 * 使用独立 key，避免与 dashboard 页面搜索状态冲突
 */
const ldSearchData = useMemory("myDashboard-leaderboard-search-data", {
  name: "", // 物品名称关键字
  project: "", // 动作类型
  profitRate: 10, // 最低利润率（%）
  maxItemLevel: undefined, // 最大物品等级限制
  banEquipment: true, // 是否排除装备
  banCharm: false // 是否排除护符
})

/**
 * 是否计算税率（持久化）
 * 独立 key 与 dashboard 区分，两个页面的税率选项互不干扰
 */
const includeTax = useMemory("myDashboard-include-tax", true)

/** 利润排行 loading 状态 */
const loadingLD = ref(false)

/**
 * 获取利润排行数据
 * 使用 debounce 避免搜索输入时频繁请求，防抖 300ms
 */
const getLeaderboardData = debounce(() => {
  loadingLD.value = true
  getLeaderboardDataApi({
    currentPage: paginationDataLD.currentPage,
    size: paginationDataLD.pageSize,
    includeTax: includeTax.value,
    ...ldSearchData.value,
    sort: sortLD.value
  }).then((data) => {
    // 同步更新总条数与列表数据
    // 使用扩展运算符创建新数组引用，确保手动价格变化时触发响应式更新
    // （即使 API 返回同一份缓存数据，Vue 也能检测到引用变化并重新计算）
    paginationDataLD.total = data.total
    leaderboardData.value = [...data.list]
  }).catch((e) => {
    console.error(e)
    leaderboardData.value = []
  }).finally(() => {
    loadingLD.value = false
  })
}, 300)

/**
 * 搜索利润排行
 * 当前页为第 1 页时直接请求；否则重置到第 1 页，watch 会自动触发请求
 */
function handleSearchLD() {
  paginationDataLD.currentPage === 1 ? getLeaderboardData() : (paginationDataLD.currentPage = 1)
}

/** 利润排行当前排序条件 */
const sortLD: Ref<Sort | undefined> = ref()

/**
 * 处理利润排行表格排序变更
 * @param sort 排序对象（包含 prop 和 order）
 */
function handleSortLD(sort: Sort) {
  sortLD.value = sort
  getLeaderboardData()
}

/**
 * 监听利润排行相关状态变化，自动重新请求
 * 包括：分页参数、税率开关、市场数据、玩家配置、买卖状态
 */
watch([
  () => paginationDataLD.currentPage,
  () => paginationDataLD.pageSize,
  () => includeTax.value,
  () => useGameStore().marketData,
  () => usePlayerStore().config,
  () => useGameStore().buyStatus,
  () => useGameStore().sellStatus
], getLeaderboardData, { immediate: true })

// #endregion

// =============================================
// #region 收藏夹模块（Favorite）
// =============================================

/**
 * 收藏夹分页数据
 * key 使用 "myDashboard-" 前缀，独立于 dashboard 的收藏夹分页状态
 */
const {
  paginationData: paginationDataMN,
  handleCurrentChange: handleCurrentChangeFR,
  handleSizeChange: handleSizeChangeFR
} = usePagination({}, "myDashboard-favorite-pagination")

/** 收藏夹列表数据 */
const favoriteData = ref<Calculator[]>([])

/** 收藏夹搜索表单 ref */
const frSearchFormRef = ref<FormInstance | null>(null)

/**
 * 收藏夹搜索条件（持久化）
 * 使用独立 key，避免与 dashboard 页面搜索状态冲突
 */
const frSearchData = useMemory("myDashboard-favorite-search-data", {
  name: "", // 物品名称关键字
  project: "", // 动作类型
  banCharm: false // 是否排除护符
})

/** 收藏夹 loading 状态 */
const loadingFR = ref(false)

/** 获取收藏夹数据 */
function getFavoriteData() {
  loadingFR.value = true
  getFavoriteDataApi({
    currentPage: paginationDataMN.currentPage,
    size: paginationDataMN.pageSize,
    includeTax: includeTax.value,
    ...frSearchData.value
  }).then((data) => {
    paginationDataMN.total = data.total
    // 使用扩展运算符创建新数组引用，确保手动价格变化时触发响应式更新
    favoriteData.value = [...data.list]
  }).catch(() => {
    favoriteData.value = []
  }).finally(() => {
    loadingFR.value = false
  })
}

/**
 * 搜索收藏夹
 * 当前页为第 1 页时直接请求；否则重置到第 1 页
 */
function handleSearchMN() {
  paginationDataMN.currentPage === 1 ? getFavoriteData() : (paginationDataMN.currentPage = 1)
}

/**
 * 税率复选框变更时，同步刷新排行和收藏夹
 */
function handleIncludeTaxChange() {
  handleSearchLD()
  handleSearchMN()
}

/**
 * 监听收藏夹相关状态变化，自动重新请求
 * 包括：分页参数、税率开关、市场数据、玩家配置、买卖状态
 */
watch([
  () => paginationDataMN.currentPage,
  () => paginationDataMN.pageSize,
  () => includeTax.value,
  () => useGameStore().marketData,
  () => usePlayerStore().config,
  () => useGameStore().buyStatus,
  () => useGameStore().sellStatus
], getFavoriteData, { immediate: true })

// #endregion

// =============================================
// #region 深监听：收藏状态 / 自定义价格变化
// =============================================

/**
 * 监听收藏夹列表变化（深监听），同步刷新排行和收藏夹
 * 适用场景：在其他页面收藏/取消收藏后，回到本页面数据自动更新
 */
watch(() => favoriteStore.list, () => {
  getLeaderboardData()
  getFavoriteData()
}, { deep: true })

/**
 * 监听自定义价格 store 变化（深监听），同步刷新排行和收藏夹
 * 适用场景：修改手动价格后，利润数据实时更新
 */
watch(() => usePriceStore(), () => {
  getLeaderboardData()
  getFavoriteData()
}, { deep: true })

// #endregion

// =============================================
// #region 详情弹窗
// =============================================

/** 当前选中行数据（用于详情弹窗展示） */
const currentRow = ref<Calculator>()

/** 详情弹窗的显示状态 */
const detailVisible = ref<boolean>(false)

/**
 * 显示详情弹窗
 * @param row 当前行数据（深拷贝，避免引用污染原始数据）
 */
async function showDetail(row: Calculator) {
  currentRow.value = cloneDeep(row)
  detailVisible.value = true
}

/**
 * 添加收藏
 * @param row 目标行数据；未传则使用当前弹窗行
 */
function addFavorite(row: Calculator) {
  const r = row || currentRow.value!
  try {
    addFavoriteApi(r)
    detailVisible.value = false
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}

/**
 * 取消收藏
 * @param row 目标行数据
 */
function deleteFavorite(row: Calculator) {
  try {
    deleteFavoriteApi(row)
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}

// #endregion

// =============================================
// #region 自定义价格弹窗
// =============================================

/** 自定义价格弹窗的显示状态 */
const priceVisible = ref<boolean>(false)

/** 当前正在编辑自定义价格的行数据 */
const currentPriceRow = ref<Calculator>()

/**
 * 打开自定义价格弹窗
 * 若未开启自定义价格功能，弹出确认框引导用户先开启
 * @param row 目标行数据
 */
function setPrice(row: Calculator) {
  const activated = usePriceStore().activated
  if (!activated) {
    // 未开启时弹出确认框，引导用户开启自定义价格功能
    ElMessageBox.confirm(t("是否确定开启自定义价格？"), t("需先开启自定义价格"), {
      confirmButtonText: t("确定"),
      cancelButtonText: t("取消"),
      closeOnClickModal: true
    }).then(() => {
      usePriceStore().setActivated(true)
    })
    return
  }
  currentPriceRow.value = cloneDeep(row)
  priceVisible.value = true
}

// #endregion

// =============================================
// #region 国际化
// =============================================

/** 国际化 t 函数，用于多语言文本转换 */
const { t } = useI18n()

// #endregion

// =============================================
// #region 工具函数
// =============================================

/**
 * 格式化 1h 成交量
 * @param row 当前行数据
 * @returns 格式化后的成交量字符串，数据不存在时返回 "-"
 */
function formatVolume1h(row: any) {
  const hrid = row?.hrid
  const level = row?.calculator?.enhanceLevel ?? 0
  const vol = getPriceOf(hrid, level).vol ?? -1
  return vol < 0 ? "-" : Format.number(vol)
}

/**
 * 价格状态变更回调（持久化到 localStorage）
 * key 使用 "myDashboard-" 前缀，与 dashboard 页面的价格状态相互独立
 */
const onPriceStatusChange = usePriceStatus("myDashboard-price-status")

// #endregion
</script>

<template>
  <!-- 我的看板页面根容器 -->
  <div class="app-container">
    <!-- =============================================
      顶部工具栏：游戏信息 + 动作配置 + 价格状态 + 税率开关
    ============================================= -->
    <div class="game-info">
      <!-- 游戏信息（服务器时间、当前游戏状态等） -->
      <GameInfo />

      <!-- 动作配置（玩家等级、装备加成等） -->
      <div>
        <ActionConfig />
      </div>

      <!-- 价格状态选择（影响买入/卖出价格的计算来源） -->
      <PriceStatusSelect
        @change="onPriceStatusChange"
      />

      <!-- 税率开关：勾选后利润计算将扣除交易税 -->
      <el-checkbox v-model="includeTax" @change="handleIncludeTaxChange">
        {{ t('计算税率') }}
      </el-checkbox>
    </div>

    <!-- =============================================
      主体内容区：利润排行 + 手动价格卡片 + 收藏夹
    ============================================= -->
    <el-row :gutter="20" class="row">
      <!-- ——————————————————————————————————————
        利润排行榜卡片（Leaderboard）
      —————————————————————————————————————————— -->
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <!-- 卡片头部：标题 + 搜索筛选表单 -->
          <template #header>
            <el-form class="rank-card" ref="ldSearchFormRef" :inline="true" :model="ldSearchData">
              <!-- 模块标题 -->
              <div class="title">
                {{ t('利润排行') }}
              </div>

              <!-- 搜索：物品名称 -->
              <el-form-item prop="name" :label="t('物品')">
                <el-input style="width:100px" v-model="ldSearchData.name" :placeholder="t('请输入')" clearable @input="handleSearchLD" />
              </el-form-item>

              <!-- 搜索：动作类型 -->
              <el-form-item prop="phone" :label="t('动作')">
                <el-select v-model="ldSearchData.project" :placeholder="t('请选择')" style="width:100px" clearable @change="handleSearchLD">
                  <!-- 所有可选动作类型 -->
                  <el-option :label="t('挤奶')" :value="t('挤奶')" />
                  <el-option :label="t('采摘')" :value="t('采摘')" />
                  <el-option :label="t('伐木')" :value="t('伐木')" />
                  <el-option :label="t('锻造')" :value="t('锻造')" />
                  <el-option :label="t('制造')" :value="t('制造')" />
                  <el-option :label="t('裁缝')" :value="t('裁缝')" />
                  <el-option :label="t('烹饪')" :value="t('烹饪')" />
                  <el-option :label="t('冲泡')" :value="t('冲泡')" />
                  <el-option :label="t('点金')" :value="t('点金')" />
                  <el-option :label="t('分解')" :value="t('分解')" />
                  <el-option :label="t('转化')" :value="t('转化')" />
                </el-select>
              </el-form-item>

              <!-- 搜索：最低利润率 -->
              <el-form-item prop="name" :label="`${t('利润率')} >`">
                <el-input style="width:60px" v-model="ldSearchData.profitRate" :placeholder="t('请输入')" clearable @input="handleSearchLD" />&nbsp;%
              </el-form-item>

              <!-- 搜索：要求等级下限 -->
              <el-form-item :label="`${t('要求等级')} ≥`">
                <el-input-number
                  v-model="ldSearchData.actionLevel"
                  :min="0"
                  :max="120"
                  :controls="false"
                  @change="handleSearchLD"
                  style="width: 60px;"
                />
              </el-form-item>

              <!-- 搜索：物品等级上限 -->
              <el-form-item :label="`${t('物品等级')} ≤`">
                <el-input-number
                  v-model="ldSearchData.maxItemLevel"
                  :controls="false"
                  @change="handleSearchLD"
                  style="width: 80px;"
                />
              </el-form-item>

              <!-- 过滤：排除装备 -->
              <el-form-item>
                <el-checkbox v-model="ldSearchData.banEquipment" @change="handleSearchLD">
                  {{ t('排除装备') }}
                </el-checkbox>
              </el-form-item>

              <!-- 过滤：排除护符 -->
              <el-form-item>
                <el-checkbox v-model="ldSearchData.banCharm" @change="handleSearchLD">
                  {{ t('排除护符') }}
                </el-checkbox>
              </el-form-item>
            </el-form>
          </template>

          <!-- 排行榜数据表格 -->
          <template #default>
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD">
              <!-- 物品图标 -->
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>

              <!-- 物品名称 -->
              <el-table-column prop="result.name" :label="t('物品')" />

              <!-- 催化剂图标（强化相关） -->
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                </template>
              </el-table-column>

              <!-- 动作类型 -->
              <el-table-column prop="project" :label="t('动作')" />

              <!-- 要求等级：玩家等级不足时高亮红色 -->
              <el-table-column prop="actionLevel" :label="t('要求等级')" align="center">
                <template #default="{ row }">
                  <div :class="row.actionLevel > getActionConfigOf(row.action).playerLevel ? 'red' : ''">
                    {{ row.actionLevel }}
                  </div>
                </template>
              </el-table-column>

              <!-- 利润/天：支持自定义价格入口 -->
              <el-table-column :label="t('利润 / 天')" align="center" min-width="120">
                <template #default="{ row }">
                  <!-- 蓝色表示当前使用了自定义价格 -->
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPDFormat }}&nbsp;
                  </span>
                  <!-- 点击打开自定义价格弹窗 -->
                  <el-link type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>

              <!-- 利润/小时 -->
              <el-table-column prop="result.profitPHFormat" :label="t('利润 / h')" align="center" min-width="120" />

              <!-- 利润率：支持降序排序 -->
              <el-table-column prop="result.profitRate" :label="t('利润率')" min-width="120" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.profitRateFormat }}
                </template>
              </el-table-column>

              <!-- 利润/次：带 tooltip 说明多步动作 -->
              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('利润 / 次') }}</div>
                    <!-- 多步动作利润说明 tooltip -->
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('单次动作产生的利润。') }}
                        <br>
                        {{ t('#多步动作利润提示') }}
                        <br>
                        {{ t('#多步动作利润举例') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPPFormat }}&nbsp;
                  </span>
                </template>
              </el-table-column>

              <!-- 经验/小时：支持多技能经验 tooltip -->
              <el-table-column min-width="120" :label="t('经验 / h')" align="center">
                <template #default="{ row }">
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ row.result.expPHFormat }}</div>
                    <!-- 多技能经验明细 tooltip -->
                    <el-tooltip v-if="row.expList?.length > 1" placement="top" effect="light">
                      <template #content>
                        <div v-for="(item, i) in row.expList" :key="i" style="display: flex; gap:10px">
                          <div>{{ t(item.action) }}</div>
                          <div>{{ item.expPHFormat }}</div>
                        </div>
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>

              <!-- 成交量(1h) -->
              <el-table-column :label="t('成交量(1h)')" align="center" min-width="120">
                <template #default="{ row }">
                  {{ formatVolume1h(row) }}
                </template>
              </el-table-column>

              <!-- 查看详情 -->
              <el-table-column :label="t('详情')" align="center">
                <template #default="{ row }">
                  <el-link type="primary" :icon="Search" @click="showDetail(row)">
                    {{ t('查看') }}
                  </el-link>
                </template>
              </el-table-column>

              <!-- 收藏/取消收藏：支持排序 -->
              <el-table-column prop="favorite" :label="t('收藏')" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  <!-- 未收藏：空心星 -->
                  <el-link v-if="!favoriteStore.hasFavorite(row)" :underline="false" type="warning" :icon="Star" @click="addFavorite(row)" style="font-size:24px" />
                  <!-- 已收藏：实心星 -->
                  <el-link v-else :underline="false" :icon="StarFilled" type="warning" @click="deleteFavorite(row)" style="font-size:28px" />
                </template>
              </el-table-column>
            </el-table>
          </template>

          <!-- 排行榜分页 -->
          <template #footer>
            <div class="pager-wrapper">
              <el-pagination
                background
                :layout="paginationDataLD.layout"
                :page-sizes="paginationDataLD.pageSizes"
                :total="paginationDataLD.total"
                :page-size="paginationDataLD.pageSize"
                :current-page="paginationDataLD.currentPage"
                @size-change="handleSizeChangeLD"
                @current-change="handleCurrentChangeLD"
              />
            </div>
          </template>
        </el-card>
      </el-col>

      <!-- ——————————————————————————————————————
        四向策略对比面板（独立卡片，位于排行榜与收藏夹之间）
        当排行榜有数据时自动展示四种买卖策略的利润对比
      —————————————————————————————————————————— -->
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <StrategyCompare :data="leaderboardData" />
      </el-col>

      <!-- ——————————————————————————————————————
        手动价格卡片（复用 dashboard 组件）
        使用独立 memory-key 避免与 dashboard 状态冲突
      —————————————————————————————————————————— -->
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="8">
        <ManualPriceCard memory-key="myDashboard" />
      </el-col>

      <!-- ——————————————————————————————————————
        收藏夹卡片（Favorite）
      —————————————————————————————————————————— -->
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <!-- 卡片头部：标题 + 搜索筛选表单 -->
          <template #header>
            <el-form class="rank-card" ref="frSearchFormRef" :inline="true" :model="frSearchData">
              <!-- 模块标题 -->
              <div class="title">
                {{ t('收藏夹') }}
              </div>

              <!-- 搜索：物品名称 -->
              <el-form-item prop="name" :label="t('物品')">
                <el-input style="width:100px" v-model="frSearchData.name" :placeholder="t('请输入')" clearable @input="handleSearchMN" />
              </el-form-item>

              <!-- 搜索：动作类型 -->
              <el-form-item prop="phone" :label="t('动作')">
                <el-select v-model="frSearchData.project" :placeholder="t('请选择')" style="width:100px" clearable @change="handleSearchMN">
                  <el-option :label="t('挤奶')" :value="t('挤奶')" />
                  <el-option :label="t('采摘')" :value="t('采摘')" />
                  <el-option :label="t('伐木')" :value="t('伐木')" />
                  <el-option :label="t('锻造')" :value="t('锻造')" />
                  <el-option :label="t('制造')" :value="t('制造')" />
                  <el-option :label="t('裁缝')" :value="t('裁缝')" />
                  <el-option :label="t('烹饪')" :value="t('烹饪')" />
                  <el-option :label="t('冲泡')" :value="t('冲泡')" />
                  <el-option :label="t('点金')" :value="t('点金')" />
                  <el-option :label="t('分解')" :value="t('分解')" />
                  <el-option :label="t('转化')" :value="t('转化')" />
                </el-select>
              </el-form-item>

              <!-- 过滤：排除护符 -->
              <el-form-item>
                <el-checkbox v-model="frSearchData.banCharm" @change="handleSearchMN">
                  {{ t('排除护符') }}
                </el-checkbox>
              </el-form-item>
            </el-form>
          </template>

          <!-- 收藏夹数据表格 -->
          <template #default>
            <el-table :data="favoriteData" v-loading="loadingFR">
              <!-- 物品图标 -->
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>

              <!-- 物品名称 -->
              <el-table-column prop="result.name" :label="t('物品')" />

              <!-- 催化剂图标 -->
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                </template>
              </el-table-column>

              <!-- 动作类型 -->
              <el-table-column prop="project" :label="t('动作')" />

              <!-- 利润/天：已开启自定义价格时显示编辑入口 -->
              <el-table-column :label="t('利润 / 天')">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPDFormat }}&nbsp;
                  </span>
                  <el-link v-if="usePriceStore().activated" type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>

              <!-- 利润/小时 -->
              <el-table-column prop="result.profitPHFormat" :label="t('利润 / h')" align="center" min-width="120" />

              <!-- 经验/小时 -->
              <el-table-column prop="result.expPHFormat" :label="t('经验 / h')" align="center" min-width="120" />

              <!-- 利润率 -->
              <el-table-column prop="result.profitRateFormat" :label="t('利润率')" align="center" min-width="120" />

              <!-- 利润/次 -->
              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('利润 / 次') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('单次动作产生的利润。') }}
                        <br>
                        {{ t('#多步动作利润提示') }}
                        <br>
                        {{ t('#多步动作利润举例') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPPFormat }}&nbsp;
                  </span>
                </template>
              </el-table-column>

              <!-- 成交量(1h) -->
              <el-table-column :label="t('成交量(1h)')" align="center" min-width="120">
                <template #default="{ row }">
                  {{ formatVolume1h(row) }}
                </template>
              </el-table-column>

              <!-- 查看详情 -->
              <el-table-column :label="t('详情')">
                <template #default="{ row }">
                  <el-link type="primary" :icon="Search" @click="showDetail(row)">
                    {{ t('查看') }}
                  </el-link>
                </template>
              </el-table-column>

              <!-- 删除收藏 -->
              <el-table-column :label="t('操作')">
                <template #default="{ row }">
                  <el-link type="danger" :icon=" Delete" @click="deleteFavorite(row)">
                    {{ t('删除') }}
                  </el-link>
                </template>
              </el-table-column>
            </el-table>
          </template>

          <!-- 收藏夹分页 -->
          <template #footer>
            <div class="pager-wrapper">
              <el-pagination
                background
                :layout="paginationDataMN.layout"
                :page-sizes="paginationDataMN.pageSizes"
                :total="paginationDataMN.total"
                :page-size="paginationDataMN.pageSize"
                :current-page="paginationDataMN.currentPage"
                @size-change="handleSizeChangeFR"
                @current-change="handleCurrentChangeFR"
              />
            </div>
          </template>
        </el-card>
      </el-col>
    </el-row>

    <!-- =============================================
      弹窗：详情查看
    ============================================= -->
    <ActionDetail v-model="detailVisible" :data="currentRow" />

    <!-- =============================================
      弹窗：自定义价格设置
    ============================================= -->
    <ActionPrice v-model="priceVisible" :data="currentPriceRow" />
  </div>
</template>

<style lang="scss" scoped>
/** 排行/收藏夹搜索栏容器：flex 布局，允许换行，基线对齐 */
.rank-card {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;

  /* 模块标题固定宽度，与搜索表单错开 */
  .title {
    width: 160px;
    margin-bottom: 12px;
  }
}

/** 分页器容器：居中显示 */
.pager-wrapper {
  display: flex;
  justify-content: center;
}

/** 行间距：每列卡片底部留白 */
.row {
  .el-col {
    margin-bottom: 20px;
  }
}

/** 自定义价格标识：蓝色，当价格为用户手动录入时使用 */
.manual {
  color: #409eff;
}

/** 要求等级超出玩家等级：红色高亮 */
.red {
  color: #f56c6c;
}

/** 正常/充足状态：绿色 */
.green {
  color: #67c23a;
}
</style>
