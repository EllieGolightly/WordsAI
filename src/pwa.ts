import { registerSW } from 'virtual:pwa-register'

type Listener = (needRefresh: boolean) => void

const listeners = new Set<Listener>()
let updateHandler: ((reloadPage?: boolean) => Promise<void>) | undefined

export const initPwa = () => {
  if (updateHandler) return

  updateHandler = registerSW({
    immediate: true,
    onNeedRefresh() {
      listeners.forEach((listener) => listener(true))
    },
    onRegisteredSW() {
      listeners.forEach((listener) => listener(false))
    },
  })
}

export const subscribePwaUpdates = (listener: Listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const applyPwaUpdate = async () => {
  if (!updateHandler) return
  await updateHandler(true)
}
