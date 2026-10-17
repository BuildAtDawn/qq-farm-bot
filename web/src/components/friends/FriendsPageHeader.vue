<script setup lang="ts">
import type { FriendTabKey } from './FriendsTabs.vue'
import FarmPageHeader from '@/components/ui/FarmPageHeader.vue'

defineProps<{
  activeTab: FriendTabKey
  friendsCount: number
  filteredFriendsCount: number
  blacklistCount: number
  interactRecordsCount: number
  filteredInteractRecordsCount: number
}>()

const searchKeyword = defineModel<string>('searchKeyword', { required: true })
</script>

<template>
  <FarmPageHeader class="mb-5" title="好友农场" description="和好友一起，分享庄园里的小小收获。" icon="i-carbon-user-multiple">
    <div class="min-w-0 flex flex-wrap items-center gap-3">
      <div v-if="activeTab === 'friends'" class="relative">
        <div class="i-carbon-search absolute left-3 top-1/2 text-gray-400 -translate-y-1/2" />
        <input
          v-model="searchKeyword"
          type="text"
          placeholder="搜索好友..."
          aria-label="搜索好友"
          class="w-full border border-gray-300 rounded-lg bg-white py-2 pl-10 pr-4 text-sm sm:w-64 dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
        >
      </div>
      <div v-if="activeTab === 'friends' && friendsCount" class="text-sm text-gray-500">
        共 {{ filteredFriendsCount }}/{{ friendsCount }} 名好友
      </div>
      <div v-if="activeTab === 'blacklist'" class="text-sm text-gray-500">
        共 {{ blacklistCount }} 人
      </div>
      <div v-if="activeTab === 'visitors' && interactRecordsCount" class="text-sm text-gray-500">
        共 {{ filteredInteractRecordsCount }}/{{ interactRecordsCount }} 条记录
      </div>
    </div>
  </FarmPageHeader>
</template>
