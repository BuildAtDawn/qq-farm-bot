import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { ensureAdminSession } from '@/utils/admin-auth'
import { adminNavigationDecision } from '@/utils/auth-redirect'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    { path: '/admin', redirect: '/settings?tab=system' },
    {
      path: '/mutations',
      name: 'mutations',
      redirect: to => ({ path: '/analytics', query: { ...to.query, tab: 'mutations' }, hash: to.hash }),
    },
    {
      path: '/login',
      name: 'code-login',
      component: () => import('@/views/CodeLogin.vue'),
    },
    { path: '/renewal', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  NProgress.start()
  const authenticated = await ensureAdminSession()
  return adminNavigationDecision(to, authenticated)
})

router.afterEach(() => NProgress.done())
router.onError(() => NProgress.done())

export default router
