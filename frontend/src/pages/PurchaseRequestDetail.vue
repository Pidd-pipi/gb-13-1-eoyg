<template>
  <div class="detail-page">
    <van-nav-bar title="求购详情" left-arrow @click-left="router.back" />

    <van-pull-refresh v-model="refreshing" @refresh="fetchDetail" class="detail-body">
      <van-loading v-if="loading" class="loading-center" />

      <template v-else-if="detail">
        <!-- 求购信息 -->
        <div class="request-card">
          <div class="request-header">
            <div class="request-title">{{ detail.bookTitle }}</div>
            <van-tag v-if="detail.status === 'active'" type="primary">求购中</van-tag>
            <van-tag v-else type="default">已结束</van-tag>
          </div>
          <div class="request-meta" v-if="detail.author">作者：{{ detail.author }}</div>
          <div class="request-meta" v-if="detail.isbn">ISBN：{{ detail.isbn }}</div>
          <div class="request-meta" v-if="detail.expectedPrice">
            <span class="price">期望价格：¥{{ detail.expectedPrice }}</span>
          </div>
          <div class="request-meta" v-if="detail.conditions?.length">
            新旧要求：{{ detail.conditions.join('、') }}
          </div>
          <div class="request-meta" v-if="detail.description">{{ detail.description }}</div>
          <div class="request-meta">
            {{ categoryMap[detail.category] }} · {{ detail.campus }}
          </div>
          <div class="requester-row" v-if="detail.requester">
            <van-icon name="user-o" size="13" />
            <span>{{ detail.requester.name || detail.requester.department || '匿名用户' }}</span>
          </div>
        </div>

        <!-- 报价列表 -->
        <div class="offers-section">
          <div class="offers-title">
            <span>卖家报价</span>
            <span class="offers-count">待选 {{ pendingCount }}/{{ maxPending }} 条</span>
          </div>

          <van-empty v-if="detail.offers.length === 0" description="暂无报价" image-size="80" />

          <div v-for="offer in detail.offers" :key="offer.id" class="offer-card">
            <div class="offer-main">
              <div class="offer-seller">
                <van-image
                  round
                  width="36"
                  height="36"
                  :src="offer.seller?.avatarUrl || 'https://img.yzcdn.cn/vant/user-inactive.png'"
                />
                <div class="seller-info">
                  <div class="seller-name">
                    {{ offer.seller?.name || offer.seller?.department || '匿名卖家' }}
                  </div>
                  <div class="seller-meta" v-if="offer.seller?.department">
                    {{ offer.seller.department }}
                  </div>
                </div>
                <van-tag :type="statusTagType(offer.status)">{{ offerStatusMap[offer.status] }}</van-tag>
              </div>

              <div class="offer-fields">
                <span class="offer-price">¥{{ offer.price }}</span>
                <span>{{ offerConditionMap[offer.condition] }}</span>
                <span>取书：{{ offer.pickupLocation }}</span>
              </div>
              <div class="offer-expire">报价截止：{{ formatDate(offer.expireAt) }}</div>
              <div class="offer-fail" v-if="offer.status !== 'pending' && offer.status !== 'accepted'">
                {{ offer.failReason || defaultFailReason(offer.status) }}
              </div>
            </div>

            <div class="offer-actions">
              <!-- 发布者：仅待选报价可确认 -->
              <van-button
                v-if="isRequester && detail.status === 'active' && offer.status === 'pending'"
                type="primary"
                size="small"
                round
                :loading="confirmingId === offer.id"
                @click="onConfirm(offer)"
              >
                确认采纳
              </van-button>

              <!-- 卖家本人：待选可撤回、可修改 -->
              <template v-if="isSeller(offer)">
                <van-button
                  v-if="offer.status === 'pending' && detail.status === 'active'"
                  size="small"
                  round
                  :loading="withdrawingId === offer.id"
                  @click="onWithdraw(offer)"
                >
                  撤回
                </van-button>
                <van-button
                  v-if="canResubmit(offer)"
                  type="primary"
                  plain
                  size="small"
                  round
                  @click="openSubmitPopup(offer)"
                >
                  {{ offer.status === 'pending' ? '修改报价' : '重新报价' }}
                </van-button>
              </template>

              <!-- 采纳后可联系卖家 -->
              <van-button
                v-if="offer.status === 'accepted' && offer.seller && !isSeller(offer)"
                type="success"
                size="small"
                round
                @click="contactSeller(offer)"
              >
                联系卖家
              </van-button>
            </div>
          </div>
        </div>
      </template>

      <van-empty v-else description="求购信息不存在" />
    </van-pull-refresh>

    <!-- 底部操作：原关闭入口仍可用 -->
    <div class="bottom-actions" v-if="detail">
      <van-button
        v-if="isRequester"
        type="default"
        block
        :disabled="detail.status !== 'active'"
        :loading="closing"
        @click="onClose"
      >
        {{ detail.status === 'active' ? '关闭求购' : '求购已结束' }}
      </van-button>
      <van-button
        v-else
        type="primary"
        block
        :disabled="!canSubmit"
        @click="openSubmitPopup()"
      >
        {{ myOffer ? (myOffer.status === 'pending' ? '修改我的报价' : '重新报价') : '我要报价' }}
      </van-button>
    </div>

    <!-- 提交/修改报价 -->
    <van-popup v-model:show="showSubmit" position="bottom" round :style="{ maxHeight: '85%' }">
      <van-nav-bar :title="editingOffer ? '修改报价' : '提交报价'" :left-arrow="false" />
      <van-form @submit="onSubmitOffer">
        <van-cell-group inset>
          <van-field
            v-model.number="offerForm.price"
            type="number"
            label="报价"
            placeholder="请输入价格"
            :rules="[{ required: true, message: '请输入报价' }]"
          >
            <template #button>元</template>
          </van-field>
          <van-field name="condition" label="成色" :rules="[{ required: true, message: '请选择成色' }]">
            <template #input>
              <van-radio-group v-model="offerForm.condition" direction="horizontal">
                <van-radio name="new">全新</van-radio>
                <van-radio name="like_new">九成新</van-radio>
                <van-radio name="good">七成新</van-radio>
                <van-radio name="fair">五成新</van-radio>
              </van-radio-group>
            </template>
          </van-field>
          <van-field
            v-model="offerForm.pickupLocation"
            label="取书地点"
            placeholder="如图书馆门口、某宿舍楼下"
            :rules="[{ required: true, message: '请填写取书地点' }]"
          />
          <van-field
            v-model="expireAtText"
            is-link
            readonly
            label="失效时间"
            placeholder="请选择报价失效时间"
            :rules="[{ required: true, message: '请选择失效时间' }]"
            @click="showDatePicker = true"
          />
        </van-cell-group>
        <div class="submit-tip">
          提交后在失效时间前保持待选；同一求购最多 {{ maxPending }} 条待选报价，重提将更新原报价。
        </div>
        <div class="submit-actions">
          <van-button round block type="primary" native-type="submit" :loading="submitting">
            {{ editingOffer ? '更新报价' : '提交报价' }}
          </van-button>
        </div>
      </van-form>
    </van-popup>

    <van-popup v-model:show="showDatePicker" position="bottom" round teleport="body">
      <van-date-picker
        v-model="datePickerValue"
        title="选择失效日期"
        :min-date="minDate"
        :max-date="maxDate"
        @confirm="onDateConfirm"
        @cancel="showDatePicker = false"
      />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showConfirmDialog } from 'vant';
import {
  getPurchaseRequestById,
  closePurchaseRequest,
  submitOffer,
  withdrawOffer,
  confirmOffer,
} from '@/api/purchase';
import { useAuthStore } from '@/store/auth';
import type { PurchaseRequest, PurchaseOffer, OfferCondition } from '@/types';
import {
  categoryMap,
  offerConditionMap,
  offerStatusMap,
} from '@/types';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const maxPending = 3;

const loading = ref(true);
const refreshing = ref(false);
const detail = ref<(PurchaseRequest & { offers: PurchaseOffer[] }) | null>(null);

const closing = ref(false);
const submitting = ref(false);
const withdrawingId = ref<string | null>(null);
const confirmingId = ref<string | null>(null);

const showSubmit = ref(false);
const editingOffer = ref<PurchaseOffer | null>(null);
const offerForm = reactive({
  price: '' as number | string,
  condition: '' as OfferCondition | '',
  pickupLocation: '',
});
const expireAtText = ref('');
let expireAtValue: Date | null = null;

const showDatePicker = ref(false);
const datePickerValue = ref<string[]>([]);
const minDate = new Date();
const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const isRequester = computed(
  () => !!authStore.user && detail.value?.requesterId === authStore.user.id,
);

const myOffer = computed(
  () => detail.value?.offers.find((offer) => offer.sellerId === authStore.user?.id) ?? null,
);

const canSubmit = computed(() => {
  if (!detail.value || detail.value.status !== 'active') return false;
  if (isRequester.value) return false;
  const pending = detail.value.pendingOfferCount ?? 0;
  if (!myOffer.value) return pending < maxPending;
  // 待选可直接修改；撤回/失效后重提要占用一个待选名额
  if (myOffer.value.status === 'pending') return true;
  if (['withdrawn', 'expired'].includes(myOffer.value.status)) return pending < maxPending;
  return false;
});

const pendingCount = computed(
  () => detail.value?.offers.filter((o) => o.status === 'pending').length ?? 0,
);

const isSeller = (offer: PurchaseOffer) => offer.sellerId === authStore.user?.id;

// 待选可直接修改；撤回/失效重提时必须仍有待选名额
const canResubmit = (offer: PurchaseOffer) => {
  if (!detail.value || detail.value.status !== 'active') return false;
  if (offer.status === 'pending') return true;
  if (offer.status === 'withdrawn' || offer.status === 'expired') {
    return (detail.value.pendingOfferCount ?? 0) < maxPending;
  }
  return false;
};

const statusTagType = (status: PurchaseOffer['status']) => {
  switch (status) {
    case 'pending':
      return 'primary';
    case 'accepted':
      return 'success';
    case 'expired':
    case 'withdrawn':
      return 'default';
    default:
      return 'warning';
  }
};

const defaultFailReason = (status: PurchaseOffer['status']) => {
  if (status === 'expired') return '报价已失效';
  if (status === 'withdrawn') return '卖家已撤回报价';
  if (status === 'declined') return '报价未被采纳';
  return '';
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fetchDetail = async () => {
  try {
    const data = await getPurchaseRequestById(route.params.id as string);
    detail.value = data;
  } catch {
    detail.value = null;
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
};

const openSubmitPopup = (offer?: PurchaseOffer) => {
  if (!authStore.isAuthenticated) {
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }
  editingOffer.value = offer ?? myOffer.value ?? null;
  if (editingOffer.value) {
    offerForm.price = Number(editingOffer.value.price);
    offerForm.condition = editingOffer.value.condition;
    offerForm.pickupLocation = editingOffer.value.pickupLocation;
    const expire = new Date(editingOffer.value.expireAt);
    expireAtValue = expire > new Date() ? expire : null;
    expireAtText.value = expireAtValue ? formatDate(expireAtValue.toISOString()) : '';
    const pad = (n: number) => String(n).padStart(2, '0');
    datePickerValue.value = expireAtValue
      ? [
          String(expireAtValue.getFullYear()),
          pad(expireAtValue.getMonth() + 1),
          pad(expireAtValue.getDate()),
        ]
      : [];
  } else {
    offerForm.price = '';
    offerForm.condition = '';
    offerForm.pickupLocation = '';
    expireAtValue = null;
    expireAtText.value = '';
    datePickerValue.value = [];
  }
  showSubmit.value = true;
};

const onDateConfirm = ({ selectedValues }: { selectedValues: string[] }) => {
  const [year, month, day] = selectedValues.map(Number);
  const base = new Date(year, month - 1, day, 23, 59);
  expireAtValue = base;
  datePickerValue.value = selectedValues;
  expireAtText.value = formatDate(base.toISOString());
  showDatePicker.value = false;
};

const onSubmitOffer = async () => {
  if (!expireAtValue || expireAtValue.getTime() <= Date.now()) {
    showToast('请选择晚于当前时间的失效时间');
    return;
  }
  submitting.value = true;
  try {
    await submitOffer(detail.value!.id, {
      price: Number(offerForm.price),
      condition: offerForm.condition as OfferCondition,
      pickupLocation: offerForm.pickupLocation.trim(),
      expireAt: expireAtValue.toISOString(),
    });
    showToast(editingOffer.value ? '报价已更新' : '报价提交成功');
    showSubmit.value = false;
    await fetchDetail();
  } catch {
    // 失败原因已由请求拦截器提示；全部保持原样
  } finally {
    submitting.value = false;
  }
};

const onWithdraw = async (offer: PurchaseOffer) => {
  try {
    await showConfirmDialog({ title: '撤回报价', message: '确定撤回该报价吗？' });
  } catch {
    return;
  }
  withdrawingId.value = offer.id;
  try {
    await withdrawOffer(detail.value!.id, offer.id);
    showToast('报价已撤回');
    await fetchDetail();
  } catch {
    // 保持原样
  } finally {
    withdrawingId.value = null;
  }
};

const onConfirm = async (offer: PurchaseOffer) => {
  try {
    await showConfirmDialog({
      title: '确认采纳',
      message: `确认采纳 ¥${offer.price}（${offerConditionMap[offer.condition]}）的报价吗？确认后求购与其余报价将一同结束。`,
    });
  } catch {
    return;
  }
  confirmingId.value = offer.id;
  try {
    await confirmOffer(detail.value!.id, offer.id);
    showToast('已确认报价，求购结束');
    await fetchDetail();
  } catch {
    // 失效/撤回/重复确认等失败时全部保持原样
  } finally {
    confirmingId.value = null;
  }
};

const onClose = async () => {
  try {
    await showConfirmDialog({ title: '关闭求购', message: '确定关闭该求购吗？待选报价将一同结束。' });
  } catch {
    return;
  }
  closing.value = true;
  try {
    await closePurchaseRequest(detail.value!.id);
    showToast('求购已关闭');
    await fetchDetail();
  } catch {
    // 保持原样
  } finally {
    closing.value = false;
  }
};

const contactSeller = (offer: PurchaseOffer) => {
  if (!offer.seller) return;
  router.push(`/chat/${offer.seller.id}`);
};

onMounted(async () => {
  if (authStore.isAuthenticated && !authStore.user) {
    await authStore.fetchCurrentUser();
  }
  fetchDetail();
});
</script>

<style scoped>
.detail-page {
  padding-bottom: 80px;
}
.detail-body {
  min-height: 60vh;
}
.loading-center {
  display: flex;
  justify-content: center;
  padding: 100px;
}
.request-card {
  background: white;
  margin: 12px;
  border-radius: 8px;
  padding: 16px;
}
.request-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.request-title {
  font-size: 18px;
  font-weight: 500;
  color: #1a1a1a;
  flex: 1;
  margin-right: 8px;
}
.request-meta {
  font-size: 13px;
  color: #666;
  margin-top: 8px;
}
.request-meta .price {
  color: #ff4d4f;
  font-size: 16px;
  font-weight: 500;
}
.requester-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #999;
}
.offers-section {
  margin: 0 12px;
}
.offers-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  padding: 4px 4px 12px;
}
.offers-count {
  font-size: 12px;
  font-weight: 400;
  color: #999;
}
.offer-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.offer-seller {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seller-info {
  flex: 1;
}
.seller-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
}
.seller-meta {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.offer-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 13px;
  color: #333;
}
.offer-price {
  font-size: 18px;
  font-weight: bold;
  color: #ff4d4f;
}
.offer-expire {
  margin-top: 6px;
  font-size: 12px;
  color: #999;
}
.offer-fail {
  margin-top: 6px;
  font-size: 12px;
  color: #ee0a24;
}
.offer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f5f5f5;
}
.bottom-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 16px;
  background: white;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
}
.submit-tip {
  padding: 12px 24px 0;
  font-size: 12px;
  color: #999;
  line-height: 1.6;
}
.submit-actions {
  padding: 16px 24px 24px;
}
</style>
