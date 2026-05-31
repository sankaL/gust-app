export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined') return false

  const ua = window.navigator.userAgent
  const isIPhone = /iphone|ipod/i.test(ua)
  const isAndroidPhone = /android/i.test(ua) && /mobile/i.test(ua)
  const isOtherPhone = /webos|iemobile|blackberry|opera mini/i.test(ua)

  // Explicitly check for iPads (iPads on iOS 13+ default to a Macintosh user agent but have multi-touch capabilities)
  const isIPad =
    /ipad/i.test(ua) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)

  return (isIPhone || isAndroidPhone || isOtherPhone) && !isIPad
}
