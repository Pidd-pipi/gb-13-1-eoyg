<template>
  <div class="page-container">
    <van-nav-bar title="求购详情" left-arrow @click-left="router.back" />

    <van-loading v-if="loading" class="loading-center" />

    <div v-else-if="request">
      <div class="request-info">
        <div class="request-header">
          <div class="request-title">{{ request.bookTitle }}</div>
          <van-tag v-if="request.status === 'active'" type="primary">求购中</van-tag>
          <van-tag v-else type="default">已关闭</van-tag>
        </div>
        <div class="request-meta">
          <span v-if="request.author" class="meta-item">作者：{{ request.author }}</span>
          <span v-if="request.isbn" class="meta-item">ISBN：{{ request.isbn }}</span>
          <span v-if="request.expectedPrice" class="meta-item meta-price">期望价格：¥{{ request.expectedPrice }}</span>
          <span v-if="request.conditions?.length" class="meta-item">新旧要求：{{ request.conditions.join('、') }}</span>
          <span class="meta-item">分类：{{ categoryMap[request.category] }}</span>
          <span class="meta-item">校区：{{ request.campus }}</span>
        </div>
        <div class="request-desc" v-if="request.description">{{ request.description }}</div>
        <div class="request-footer">
          <div class="requester" v-if="request.requester">
            <van-icon name="user-o" size="14" />
            <span>{{ request.requester.name || request.requester.department || '匿名' }}</span>
          </div>
          <span class="request-time">{{ formatTime(request.createdAt) }}</span>
        </div>
      </div>

      <div class="offers-section">
        <div class="offers-header">
          <h3 class="offers-title">报价协商</h3>
          <span class="offers-count">待选 {{ displayPendingCount }} · 共 {{ displayTotalCount }} 条</span>
        </div>

        <van-empty v-if="visibleOffers.length === 0" description="暂无报价" />

        <div v-for="offer in visibleOffers" :key="offer.id" class="offer-card">
          <div class="offer-header">
            <div class="offer-seller">
              <van-image
                round
                width="28"
                height="28"
                :src="offer.seller?.avatarUrl || 'https://img.yzcdn.cn/vant/user-inactive.png'"
              />
              <div class="offer-seller-info">
                <div class="offer-seller-name">{{ offer.seller?.name || '匿名卖家' }}</div>
                <div class="offer-seller-dept">{{ offer.seller?.department || '未填写院系' }}</div>
              </div>
            </div>
            <van-tag :type="offerTagType(offer.status)">{{ offerStatusMap[offer.status] }}</van-tag>
          </div>
          <div class="offer-body">
            <span class="offer-price">¥{{ offer.price }}</span>
            <span class="offer-meta">成色：{{ conditionMap[offer.condition] }}</span>
            <span class="offer-meta">取书地点：{{ offer.pickupLocation }}</span>
            <span class="offer-meta">失效时间：{{ formatTime(offer.expiresAt) }}</span>
          </div>
          <div class="offer-failure" v-if="offer.status !== 'pending' && offer.failureReason">
            失败原因：{{ offer.failureReason }}
          </div>
          <div class="offer-actions" v-if="canConfirm(offer) || canOperate(offer)">
            <van-button
              v-if="canConfirm(offer)"
              size="small"
              type="primary"
              :loading="confirmingId === offer.id"
              @click="onConfirm(offer)"
            >
              确认成交
            </van-button>
            <template v-if="canOperate(offer)">
              <van-button size="small" @click="openOfferForm">修改报价</van-button>
              <van-button size="small" type="danger" plain @click="onWithdraw(offer)">撤回</van-button>
            </template>
          </div>
        </div>
      </div>

      <div class="bottom-actions">
        <template v-if="isRequester">
          <van-button v-if="request.status === 'active'" type="danger" block round @click="onCloseRequest">
            关闭求购
          </van-button>
          <van-button v-else block round disabled>求购已结束</van-button>
        </template>
        <template v-else-if="request.status === 'active'">
          <van-button type="primary" block round @click="openOfferForm">{{ offerButtonText }}</van-button>
        </template>
        <van-button v-else block round disabled>求购已结束</van-button>
      </div>
    </div>

    <van-empty v-else description="求购信息不存在" />

    <van-popup v-model:show="showOfferForm" position="bottom" round>
      <div class="offer-form">
        <h3 class="offer-form-title">{{ myOffer ? '修改报价' : '我要报价' }}</h3>
        <van-form @submit="onSubmitOffer">
          <van-cell-group inset>
            <van-field
              v-model.number="offerForm.price"
              type="number"
              name="price"
              label="价格"
              placeholder="¥"
              :rules="[{ required: true, message: '请输入价格' }]"
            />
            <van-field
              v-model="offerForm.condition"
              name="condition"
              label="成色"
              :rules="[{ required: true, message: '请选择成色' }]"
            >
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
              name="pickupLocation"
              label="取书地点"
              placeholder="如：主校区图书馆门口"
              :rules="[{ required: true, message: '请输入取书地点' }]"
            />
            <van-field
              v-model="offerForm.expiresAtText"
              name="expiresAt"
              label="失效时间"
              :rules="[{ required: true, message: '请选择失效时间' }]"
            >
              <template #input>
                <div class="expire-trigger" @click="showDatePicker = true">
                  {{ offerForm.expiresAtText || '请选择' }}
                </div>
              </template>
            </van-field>
          </van-cell-group>
          <div class="offer-form-actions">
            <van-button round block type="primary" native-type="submit" :loading="submitting">
              提交报价
            </van-button>
          </div>
        </van-form>
      </div>
    </van-popup>

    <van-popup v-model:show="showDatePicker" position="bottom" round>
      <van-date-picker
        v-model="expireDate"
        title="选择失效日期"
        :columns-type="['year', 'month', 'day']"
        :min-date="minExpireDate"
        @confirm="onDateConfirm"
        @cancel="showDatePicker = false"
      />
    </van-popup>

    <van-popup v-model:show="showTimePicker" position="bottom" round>
      <van-time-picker
        v-model="expireTime"
        title="选择失效时间"
        :columns-type="['hour', 'minute']"
        @confirm="onTimeConfirm"
        @cancel="showTimePicker = false"
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
  getPurchaseOffers,
  submitPurchaseOffer,
  confirmPurchaseOffer,
  withdrawPurchaseOffer,
  closePurchaseRequest,
} from '@/api/purchase';
import { useAuthStore } from '@/store/auth';
import type { PurchaseRequest, PurchaseOffer, OfferStatus, BookCondition } from '@/types';
import { categoryMap, conditionMap, offerStatusMap } from '@/types';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const requestId = route.params.id as string;

const loading = ref(true);
const request = ref<PurchaseRequest | null>(null);
const offers = ref<PurchaseOffer[]>([]);
const pendingCount = ref(0);
const totalCount = ref(0);

const confirmingId = ref('');
const submitting = ref(false);
const showOfferForm = ref(false);
const showDatePicker = ref(false);
const showTimePicker = ref(false);

const offerForm = reactive({
  price: undefined as number | undefined,
  condition: '' as string,
  pickupLocation: '',
  expiresAt: '',
  expiresAtText: '',
});

const pad = (n: number) => String(n).padStart(2, '0');

const toDateParts = (d: Date) => [
  String(d.getFullYear()),
  pad(d.getMonth() + 1),
  pad(d.getDate()),
  pad(d.getHours()),
  pad(d.getMinutes()),
];

const expireDate = ref<string[]>(toDateParts(new Date(Date.now() + 24 * 60 * 60 * 1000)));
const expireTime = ref<string[]>(['20', '00']);
const pickedDate = ref<string[] | null>(null);
const minExpireDate = new Date();

const isRequester = computed(() => {
  return !!authStore.user && request.value?.requesterId === authStore.user.id;
});

const myOffer = computed(() => {
  return offers.value.find((o) => o.sellerId === authStore.user?.id);
});

// 发布者可见全部报价，其他用户后端只返回自己的报价
const visibleOffers = computed(() => offers.value);

// 非发布者只能看到自己的报价，计数也只按可见范围统计
const displayPendingCount = computed(() => {
  if (isRequester.value) return pendingCount.value;
  if (offers.value.length > 0) return offers.value.filter((o) => o.status === 'pending').length;
  return request.value?.pendingOfferCount || 0;
});
const displayTotalCount = computed(() => {
  if (isRequester.value) return totalCount.value;
  return offers.value.length;
});

const offerButtonText = computed(() => {
  if (!authStore.isAuthenticated) return '登录后报价';
  if (!myOffer.value) return '我要报价';
  return myOffer.value.status === 'pending' ? '修改报价' : '重新报价';
});

const formatTime = (value?: string) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const offerTagType = (status: OfferStatus) => {
  switch (status) {
    case 'pending':
      return 'primary';
    case 'confirmed':
      return 'success';
    case 'withdrawn':
      return 'warning';
    default:
      return 'default';
  }
};

const canConfirm = (offer: PurchaseOffer) => {
  return isRequester.value && request.value?.status === 'active' && offer.status === 'pending';
};

const canOperate = (offer: PurchaseOffer) => {
  return (
    !!authStore.user &&
    offer.sellerId === authStore.user.id &&
    request.value?.status === 'active' &&
    offer.status === 'pending'
  );
};

const fetchDetail = async () => {
  try {
    request.value = await getPurchaseRequestById(requestId);
    pendingCount.value = request.value.pendingOfferCount || 0;
    totalCount.value = request.value.pendingOfferCount || 0;
    if (authStore.isAuthenticated) {
      const result = await getPurchaseOffers(requestId);
      offers.value = result.offers;
      pendingCount.value = result.pendingCount;
      totalCount.value = result.totalCount;
    }
  } catch {
  } finally {
    loading.value = false;
  }
};

const openOfferForm = () => {
  if (!authStore.isAuthenticated) {
    router.push('/login');
    return;
  }
  const existing = myOffer.value;
  offerForm.price = existing ? Number(existing.price) : undefined;
  offerForm.condition = existing?.condition || '';
  offerForm.pickupLocation = existing?.pickupLocation || '';
  offerForm.expiresAt = '';
  offerForm.expiresAtText = '';
  pickedDate.value = null;
  const defaultDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  expireDate.value = toDateParts(defaultDate);
  expireTime.value = [pad(defaultDate.getHours()), pad(defaultDate.getMinutes())];
  showOfferForm.value = true;
};

const onDateConfirm = ({ selectedValues }: { selectedValues: string[] }) => {
  pickedDate.value = selectedValues;
  showDatePicker.value = false;
  showTimePicker.value = true;
};

const onTimeConfirm = ({ selectedValues }: { selectedValues: string[] }) => {
  if (!pickedDate.value) {
    showTimePicker.value = false;
    return;
  }
  const [year, month, day] = pickedDate.value;
  const [hour, minute] = selectedValues;
  offerForm.expiresAt = `${year}-${month}-${day}T${hour}:${minute}:00`;
  offerForm.expiresAtText = `${year}-${month}-${day} ${hour}:${minute}`;
  showTimePicker.value = false;
};

const onSubmitOffer = async () => {
  if (!offerForm.expiresAt) {
    showToast('请选择失效时间');
    return;
  }
  if (new Date(offerForm.expiresAt).getTime() <= Date.now()) {
    showToast('失效时间必须晚于当前时间');
    return;
  }
  submitting.value = true;
  try {
    const result = await submitPurchaseOffer(requestId, {
      price: Number(offerForm.price),
      condition: offerForm.condition as BookCondition,
      pickupLocation: offerForm.pickupLocation,
      expiresAt: offerForm.expiresAt,
    });
    showToast(result.message || '报价提交成功');
    showOfferForm.value = false;
    await fetchDetail();
  } catch {
  } finally {
    submitting.value = false;
  }
};

const onConfirm = async (offer: PurchaseOffer) => {
  try {
    await showConfirmDialog({
      title: '确认报价',
      message: `确认以 ¥${offer.price} 成交吗？确认后求购结束，其余报价将一并关闭。`,
    });
  } catch {
    return;
  }
  confirmingId.value = offer.id;
  try {
    await confirmPurchaseOffer(requestId, offer.id);
    showToast('已确认报价，求购完成');
  } catch {
    // 确认失败时所有数据保持原样，重新拉取以服务器状态为准
  } finally {
    confirmingId.value = '';
    await fetchDetail();
  }
};

const onWithdraw = async (offer: PurchaseOffer) => {
  try {
    await showConfirmDialog({
      title: '撤回报价',
      message: '确定撤回这条报价吗？',
    });
  } catch {
    return;
  }
  try {
    await withdrawPurchaseOffer(requestId, offer.id);
    showToast('报价已撤回');
  } catch {
  } finally {
    await fetchDetail();
  }
};

const onCloseRequest = async () => {
  try {
    await showConfirmDialog({
      title: '关闭求购',
      message: '关闭后所有待选报价将一并结束，确定关闭吗？',
    });
  } catch {
    return;
  }
  try {
    await closePurchaseRequest(requestId);
    showToast('求购信息已关闭');
  } catch {
  } finally {
    await fetchDetail();
  }
};

onMounted(async () => {
  if (authStore.isAuthenticated && !authStore.user) {
    await authStore.fetchCurrentUser();
  }
  await fetchDetail();
});
</script>

<style scoped>
.loading-center {
  display: flex;
  justify-content: center;
  padding: 100px;
}
.request-info {
  background: white;
  padding: 16px;
}
.request-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.request-title {
  font-size: 17px;
  font-weight: 500;
  color: #1a1a1a;
  flex: 1;
  margin-right: 8px;
}
.request-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.meta-item {
  font-size: 13px;
  color: #666;
  background: #f7f8fa;
  padding: 4px 8px;
  border-radius: 4px;
}
.meta-price {
  color: #ff4d4f;
}
.request-desc {
  margin-top: 12px;
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}
.request-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #999;
}
.requester {
  display: flex;
  align-items: center;
  gap: 4px;
}
.offers-section {
  margin-top: 8px;
  padding: 16px 12px 80px;
}
.offers-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.offers-title {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
}
.offers-count {
  font-size: 12px;
  color: #999;
}
.offer-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.offer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.offer-seller {
  display: flex;
  align-items: center;
  gap: 8px;
}
.offer-seller-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
}
.offer-seller-dept {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}
.offer-body {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}
.offer-price {
  font-size: 18px;
  font-weight: bold;
  color: #ff4d4f;
}
.offer-meta {
  font-size: 12px;
  color: #666;
  background: #f7f8fa;
  padding: 4px 8px;
  border-radius: 4px;
}
.offer-failure {
  margin-top: 10px;
  font-size: 12px;
  color: #f5222d;
}
.offer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}
.bottom-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 16px;
  background: white;
  display: flex;
  gap: 12px;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
}
.offer-form {
  padding: 16px 0 24px;
}
.offer-form-title {
  font-size: 16px;
  font-weight: 500;
  text-align: center;
  margin-bottom: 16px;
}
.offer-form-actions {
  padding: 16px 24px 0;
}
.expire-trigger {
  color: #323233;
}
</style>
