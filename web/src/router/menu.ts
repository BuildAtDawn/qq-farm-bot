export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
  showInNav?: boolean
  group?: 'estate' | 'explore' | 'manage'
  navLabel?: string
  mobileLabel?: string
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    group: 'estate',
    navLabel: '农场概览',
    mobileLabel: '概览',
    label: '概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    group: 'estate',
    navLabel: '我的农场',
    mobileLabel: '农场',
    label: '个人',
    icon: 'i-carbon-user',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    group: 'estate',
    navLabel: '好友农场',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'pet',
    name: 'pet',
    group: 'estate',
    navLabel: '宠物小屋',
    label: '宠物',
    icon: 'i-fa-solid-paw',
    component: () => import('@/views/Pet.vue'),
  },
  {
    path: 'activity',
    name: 'activity',
    group: 'explore',
    navLabel: '活动中心',
    mobileLabel: '活动',
    label: '活动',
    icon: 'i-carbon-gift',
    component: () => import('@/views/Activity.vue'),
  },
  {
    path: 'shop',
    name: 'shop',
    group: 'explore',
    navLabel: '农场商城',
    label: '商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/Shop.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    group: 'explore',
    navLabel: '收藏图鉴',
    label: '图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    group: 'explore',
    navLabel: '数据分析',
    label: '分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    group: 'manage',
    navLabel: '设置',
    mobileLabel: '设置',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
]

export const menuGroups = [
  { key: 'estate', label: '我的庄园' },
  { key: 'explore', label: '探索与成长' },
  { key: 'manage', label: '管理' },
] as const

export function visibleMenuRoutes(isAdmin: boolean) {
  return menuRoutes.filter(item => item.showInNav !== false && (!item.adminOnly || isAdmin))
}

export function menuPath(item: Pick<MenuItem, 'path'>) {
  return item.path ? `/${item.path}` : '/'
}
