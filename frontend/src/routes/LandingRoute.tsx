import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Check, X } from 'lucide-react'
import './LandingRoute.css'



const METRIC_VALUE = 3

function shouldRunCinematicTimeline() {
  if (typeof window === 'undefined') {
    return false
  }

  if (import.meta.env.MODE === 'test' || /jsdom/i.test(window.navigator.userAgent)) {
    return false
  }

  if (typeof window.matchMedia !== 'function') {
    return false
  }

  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getAdminEmail() {
  return import.meta.env.VITE_ADMIN_EMAIL?.trim() ?? ''
}

export function LandingRoute() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mainCardRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const requestRef = useRef<number | null>(null)
  const adminEmail = getAdminEmail()
  const hasAdminEmail = adminEmail.length > 0

  useLayoutEffect(() => {
    if (!shouldRunCinematicTimeline()) {
      return
    }

    gsap.registerPlugin(ScrollTrigger)

    const handleMouseMove = (event: MouseEvent) => {
      if (!mainCardRef.current || !mockupRef.current) {
        return
      }

      if (window.scrollY > window.innerHeight * 2) {
        return
      }

      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current)
      requestRef.current = window.requestAnimationFrame(() => {
        if (!mainCardRef.current || !mockupRef.current) {
          return
        }

        if (window.scrollY > window.innerHeight * 2) return

        const rect = mainCardRef.current.getBoundingClientRect()
        const mouseX = event.clientX - rect.left
        const mouseY = event.clientY - rect.top

        mainCardRef.current.style.setProperty('--mouse-x', `${mouseX}px`)
        mainCardRef.current.style.setProperty('--mouse-y', `${mouseY}px`)

        const xVal = (event.clientX / window.innerWidth - 0.5) * 2
        const yVal = (event.clientY / window.innerHeight - 0.5) * 2

        gsap.to(mockupRef.current, {
          rotateY: xVal * 12,
          rotateX: -yVal * 10,
          x: xVal * 10,
          y: yVal * 10,
          duration: 1.4,
          ease: 'power3.out',
          overwrite: true,
        })
      })
    }

    window.addEventListener('mousemove', handleMouseMove)

    const isMobile = window.innerWidth < 768
    const counterValue = { value: 0 }

    const context = gsap.context(() => {
      gsap.set('.gust-text-track', { autoAlpha: 0, y: 60, scale: 0.85, filter: 'blur(20px)', rotationX: -20 })
      gsap.set('.gust-text-days', { autoAlpha: 1, clipPath: 'inset(0 100% 0 0)' })
      gsap.set('.gust-main-card', { y: window.innerHeight + 200, autoAlpha: 1 })
      gsap.set('.gust-entry-actions', { autoAlpha: 0, y: 24, scale: 0.95 })
      gsap.set('.gust-scroll-cue', { autoAlpha: 0, y: 18 })
      gsap.set(
        [
          '.gust-card-left-text',
          '.gust-card-right-text',
          '.gust-mockup-scroll-wrapper',
          '.gust-floating-badge',
          '.gust-phone-widget',
        ],
        { autoAlpha: 0 }
      )
      gsap.set('.gust-cta-wrapper', { autoAlpha: 0, scale: 0.8, filter: 'blur(30px)' })

      gsap
        .timeline({ delay: 0.3 })
        .to('.gust-text-track', {
          duration: 1.8,
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          rotationX: 0,
          ease: 'expo.out',
        })
        .to(
          '.gust-text-days',
          { duration: 1.4, clipPath: 'inset(0 0% 0 0)', ease: 'power4.inOut' },
          '-=1.0'
        )
        .to('.gust-entry-actions', { duration: 0.9, autoAlpha: 1, y: 0, scale: 1, ease: 'expo.out' }, '-=0.6')
        .to(
          '.gust-scroll-cue',
          { duration: 0.8, autoAlpha: 1, y: 0, ease: 'power3.out' },
          '-=0.35'
        )

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: '+=7000',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      })

      timeline
        .to(['.gust-hero-text-wrapper', '.gust-bg-grid-theme'], {
          scale: 1.15,
          filter: 'blur(20px)',
          opacity: 0.2,
          ease: 'power2.inOut',
          duration: 2,
        }, 0)
        .to('.gust-entry-actions', { autoAlpha: 0, y: 24, ease: 'power2.out', duration: 0.6 }, 0)
        .to('.gust-scroll-cue', { autoAlpha: 0, y: 18, ease: 'power2.out', duration: 0.6 }, 0)
        .to('.gust-main-card', { y: 0, ease: 'power3.inOut', duration: 2 }, 0)
        .to('.gust-main-card', { width: '100%', height: '100%', borderRadius: '0px', ease: 'power3.inOut', duration: 1.5 })
        .fromTo(
          '.gust-mockup-scroll-wrapper',
          { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
          { y: 0, z: 0, rotationX: 0, rotationY: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 2.5 },
          '-=0.8'
        )
        .fromTo(
          '.gust-phone-widget',
          { y: 40, autoAlpha: 0, scale: 0.95 },
          { y: 0, autoAlpha: 1, scale: 1, stagger: 0.15, ease: 'back.out(1.2)', duration: 1.5 },
          '-=1.5'
        )
        .fromTo(
          '.gust-mic-stage',
          { autoAlpha: 0, scale: 0.88, y: 18 },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.9, ease: 'back.out(1.2)' },
          '-=1.35'
        )
        .fromTo(
          '.gust-extraction-chip',
          { autoAlpha: 0, x: -18, y: 18 },
          { autoAlpha: 1, x: 0, y: 0, duration: 0.7, stagger: 0.16, ease: 'power3.out' },
          '-=0.55'
        )
        .to(counterValue, {
          value: METRIC_VALUE,
          duration: 2,
          ease: 'expo.out',
          snap: 'value',
          onUpdate: () => {
            if (counterRef.current) {
              counterRef.current.textContent = `${Math.round(counterValue.value)}`
            }
          },
        }, '-=2.0')
        .fromTo(
          '.gust-floating-badge',
          { y: 100, autoAlpha: 0, scale: 0.7, rotationZ: -10 },
          { y: 0, autoAlpha: 1, scale: 1, rotationZ: 0, ease: 'back.out(1.5)', duration: 1.5, stagger: 0.2 },
          '-=2.0'
        )
        .fromTo('.gust-card-left-text', { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, ease: 'power4.out', duration: 1.5 }, '-=1.5')
        .fromTo('.gust-card-right-text', { x: 50, autoAlpha: 0, scale: 0.8 }, { x: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 1.5 }, '<')
        .to({}, { duration: 2.5 })
        .set('.gust-hero-text-wrapper', { autoAlpha: 0 })
        .set('.gust-cta-wrapper', { autoAlpha: 1 })
        .to({}, { duration: 1.5 })
        .to(
          ['.gust-mockup-scroll-wrapper', '.gust-floating-badge', '.gust-card-left-text', '.gust-card-right-text'],
          { scale: 0.9, y: -40, z: -200, autoAlpha: 0, ease: 'power3.in', duration: 1.2, stagger: 0.05 }
        )
        .to(
          '.gust-main-card',
          {
            width: isMobile ? '92vw' : '85vw',
            height: isMobile ? '92vh' : '85vh',
            borderRadius: isMobile ? '32px' : '40px',
            ease: 'expo.inOut',
            duration: 1.8,
          },
          'gust-pullback'
        )
        .to('.gust-cta-wrapper', { scale: 1, filter: 'blur(0px)', ease: 'expo.inOut', duration: 1.8 }, 'gust-pullback')
        .to('.gust-main-card', { y: -window.innerHeight - 300, ease: 'power3.in', duration: 1.5 })
    }, containerRef)

    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current)
      window.removeEventListener('mousemove', handleMouseMove)
      context.revert()
    }
  }, [])

  return (
    <main
      ref={containerRef}
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-surface text-on-surface antialiased"
      style={{ perspective: '1500px' }}
    >

      <div className="gust-film-grain" aria-hidden="true" />
      <div className="gust-bg-grid-theme absolute inset-0 z-0 pointer-events-none opacity-50" aria-hidden="true" />

      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.28),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(253,129,168,0.12),_transparent_24%),linear-gradient(180deg,_rgba(17,17,20,0.2)_0%,_rgba(9,9,12,0.9)_100%)]" />

      <div className="gust-hero-text-wrapper absolute inset-0 z-10 flex w-screen flex-col items-center justify-center px-4 text-center will-change-transform [transform:translateY(-8vh)] md:[transform:translateY(-7vh)]">
        <div className="mb-8 flex items-center gap-3 rounded-pill bg-white/5 px-4 py-2 shadow-[0_16px_32px_rgba(0,0,0,0.32)] ring-1 ring-white/10 backdrop-blur-xl">
          <img src="/logos/gust-wind-electric.svg" alt="" className="h-6 w-6" />
          <span className="font-body text-xs uppercase tracking-[0.24em] text-on-surface-variant">
            Voice-first task capture
          </span>
        </div>
        <h1 className="gust-text-track gust-text-3d-matte max-w-[12ch] font-display text-[3.25rem] font-bold leading-[0.9] tracking-tight md:text-[5.5rem] lg:text-[5rem]">
          Speak it once,
        </h1>
        <h1 className="gust-text-days gust-text-silver-matte max-w-[12ch] overflow-visible pb-[0.14em] font-display text-[3.25rem] font-extrabold leading-[0.94] tracking-tighter md:text-[5.5rem] lg:text-[5rem]">
          leave organized.
        </h1>
        <div className="gust-entry-actions mt-6 flex w-[min(92vw,34rem)] flex-col gap-4 px-4 sm:mt-8 sm:flex-row sm:px-0">
          {hasAdminEmail ? (
            <a
              href={`mailto:${adminEmail}`}
              aria-label="Request access to Gust"
              className="gust-btn-modern-light flex flex-1 items-center justify-center gap-3 rounded-[1.15rem] px-6 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
            >
              <span className="font-display text-lg font-bold leading-none tracking-tight">Request access</span>
            </a>
          ) : (
            <div
              aria-label="Request access unavailable"
              aria-disabled="true"
              className="gust-btn-modern-light flex flex-1 items-center justify-center gap-3 rounded-[1.15rem] px-6 py-3.5 opacity-60"
            >
              <span className="font-display text-lg font-bold leading-none tracking-tight">
                Access unavailable
              </span>
            </div>
          )}
          <Link
            to="/login"
            className="gust-btn-modern-dark flex flex-1 items-center justify-center gap-3 rounded-[1.15rem] px-6 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
          >
            <span className="font-display text-lg font-bold leading-none tracking-tight">Log in</span>
          </Link>
        </div>
      </div>

      <div className="gust-scroll-cue pointer-events-none absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-center">
        <span className="font-body text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">
          Scroll, keep scrolling
        </span>
        <div className="flex flex-col items-center gap-1">
          <span className="gust-scroll-cue-dot h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_16px_rgba(186,158,255,0.8)]" />
          <span className="gust-scroll-cue-dot h-8 w-px rounded-full bg-gradient-to-b from-primary/70 to-transparent [animation-delay:0.18s]" />
        </div>
      </div>

      <div className="gust-cta-wrapper absolute z-10 flex w-screen flex-col items-center justify-center px-4 text-center">
        <h2 className="gust-text-silver-matte font-display text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
          Private access for fast capture.
        </h2>
        <p className="mx-auto mb-12 mt-6 max-w-xl font-body text-lg leading-relaxed text-on-surface-variant md:text-xl">
          Request access to Gust or log in to your workspace to capture tasks by voice and keep
          moving.
        </p>
        <div className="flex flex-col gap-6 sm:flex-row">
          {hasAdminEmail ? (
            <a
              href={`mailto:${adminEmail}`}
              aria-label="Request access to Gust"
              className="gust-btn-modern-light flex items-center justify-center gap-3 rounded-[1.25rem] px-8 py-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
            >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8l7.2 4.8a1.5 1.5 0 001.6 0L20 8m-14 9h12a2 2 0 002-2V9a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
              </svg>
            </span>
            <div className="text-left">
              <div className="font-body text-[10px] font-bold uppercase tracking-[0.22em] text-black/50">
                Private beta
              </div>
              <div className="font-display text-xl font-bold leading-none tracking-tight">
                Request access
              </div>
            </div>
            </a>
          ) : (
            <div
              aria-label="Request access unavailable"
              aria-disabled="true"
              className="gust-btn-modern-light flex items-center justify-center gap-3 rounded-[1.25rem] px-8 py-4 opacity-60"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8l7.2 4.8a1.5 1.5 0 001.6 0L20 8m-14 9h12a2 2 0 002 2V9a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
              </span>
              <div className="text-left">
                <div className="font-body text-[10px] font-bold uppercase tracking-[0.22em] text-black/50">
                  Private beta
                </div>
                <div className="font-display text-xl font-bold leading-none tracking-tight">
                  Access unavailable
                </div>
              </div>
            </div>
          )}

          <Link
            to="/login"
            aria-label="Log in to Gust"
            className="gust-btn-modern-dark flex items-center justify-center gap-3 rounded-[1.25rem] px-8 py-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.16)]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 17l5-5-5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21h5a2 2 0 002-2V5a2 2 0 00-2-2h-5" />
              </svg>
            </span>
            <div className="text-left">
              <div className="font-body text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
                Existing workspace
              </div>
              <div className="font-display text-xl font-bold leading-none tracking-tight">Log in</div>
            </div>
          </Link>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" style={{ perspective: '1500px' }}>
        <div
          ref={mainCardRef}
          className="gust-main-card gust-premium-depth-card relative flex h-[92vh] w-[92vw] items-center justify-center overflow-hidden rounded-[32px] md:h-[85vh] md:w-[85vw] md:rounded-[40px] pointer-events-auto"
        >
          <div className="gust-card-sheen" aria-hidden="true" />

          <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-center gap-6 px-4 py-8 sm:gap-8 md:gap-10 lg:grid lg:grid-cols-3 lg:gap-8 lg:px-12 lg:py-0">
            <div className="gust-card-right-text order-1 z-20 flex w-full justify-center lg:order-3 lg:justify-end">
              <h2 className="gust-text-card-silver-matte font-display text-5xl font-black uppercase tracking-tighter sm:text-6xl md:text-[6rem] lg:text-[8rem]">
                Gust
              </h2>
            </div>

            <div
              className="gust-mockup-scroll-wrapper order-2 relative z-10 flex h-[390px] w-full items-center justify-center sm:h-[430px] lg:order-2 lg:h-[640px]"
              style={{ perspective: '1000px' }}
            >
              <div className="relative flex h-full w-full items-center justify-center scale-[0.65] md:scale-[0.82] lg:scale-100">
                <div
                  ref={mockupRef}
                  className="gust-iphone-bezel relative flex h-[580px] w-[280px] flex-col rounded-[3rem] will-change-transform"
                >
                  <div className="gust-hardware-btn absolute -left-[3px] top-[120px] z-0 h-[25px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="gust-hardware-btn absolute -left-[3px] top-[160px] z-0 h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="gust-hardware-btn absolute -left-[3px] top-[220px] z-0 h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="gust-hardware-btn absolute -right-[3px] top-[170px] z-0 h-[70px] w-[3px] scale-x-[-1] rounded-r-md" aria-hidden="true" />

                  <div className="absolute inset-[7px] z-10 overflow-hidden rounded-[2.5rem] bg-[#06070c] text-white shadow-[inset_0_0_15px_rgba(0,0,0,1)]">
                    <div className="gust-screen-glare absolute inset-0 z-40 pointer-events-none" aria-hidden="true" />

                    <div className="absolute left-1/2 top-[5px] z-50 flex h-[28px] w-[100px] -translate-x-1/2 items-center justify-end rounded-full bg-black px-3 shadow-[inset_0_-1px_2px_rgba(255,255,255,0.1)]">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary shadow-[0_0_8px_rgba(110,198,255,0.8)]" />
                    </div>

                    <div className="relative flex h-full w-full flex-col px-5 pb-8 pt-12">
                      <div className="gust-phone-widget mb-8 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-white/40">
                            Capture queue
                          </span>
                          <span className="font-display text-xl font-bold tracking-tight text-white drop-shadow-md">
                            Morning sweep
                          </span>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5">
                          <img src="/logos/gust-wind-electric.svg" alt="" className="h-4 w-4" />
                        </div>
                      </div>

                      <div className="gust-phone-widget gust-mic-stage relative mb-4 flex min-h-[260px] w-full flex-col items-center justify-start rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(253,129,168,0.12),_rgba(10,10,16,0.2)_45%,_transparent_80%)] px-3 pb-3 pt-4 drop-shadow-[0_15px_25px_rgba(0,0,0,0.8)]">
                        <div className="relative mb-4 flex h-24 w-24 items-center justify-center">
                          <div className="gust-mic-pulse-ring absolute inset-0 rounded-full border border-tertiary/45 bg-tertiary/10" />
                          <div className="gust-mic-pulse-ring gust-mic-pulse-ring-delay absolute inset-0 rounded-full border border-primary/30 bg-primary/5" />
                          <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#ffd4e5_0%,_#fd81a8_48%,_#6f1d43_100%)] shadow-[0_16px_30px_rgba(0,0,0,0.55),_0_0_32px_rgba(253,129,168,0.32),_inset_0_2px_4px_rgba(255,255,255,0.35)]">
                            <svg className="h-9 w-9 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-6m0 0a3 3 0 003-3V7a3 3 0 10-6 0v2a3 3 0 003 3zm5 0a5 5 0 01-10 0m5 5v2" />
                            </svg>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-col items-center text-center">
                          <span className="font-body text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">
                            Press to capture
                          </span>
                          <span className="font-display text-[2.15rem] font-extrabold leading-none tracking-tighter text-white">
                            <span ref={counterRef}>3</span>
                          </span>
                          <span className="mt-1 font-body text-[8px] font-bold uppercase tracking-[0.16em] text-white/45">
                            Tasks parsed
                          </span>
                        </div>
                        <div className="w-full overflow-hidden rounded-xl bg-black/10">
                          <div className="gust-extraction-chip flex min-h-10 items-center px-2.5 py-2">
                            <div className="mr-2.5 flex h-6 w-6 items-center justify-center rounded-md bg-primary/[0.06]">
                              <svg className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2z" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-body text-[10px] font-semibold text-white">Call mom</p>
                              <p className="font-body text-[9px] text-white/40">Personal task extracted</p>
                            </div>
                            <div className="ml-2 flex items-center gap-1">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/[0.08] text-success" aria-label="Approve Call mom">
                                <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                              </span>
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.03] text-white/45" aria-label="Deny Call mom">
                                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                              </span>
                            </div>
                          </div>
                          <div className="gust-extraction-chip flex min-h-10 items-center px-2.5 py-2">
                            <div className="mr-2.5 flex h-6 w-6 items-center justify-center rounded-md bg-secondary/[0.06]">
                              <svg className="h-3.5 w-3.5 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 4v16m10-9a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-body text-[10px] font-semibold text-white">Send invoice</p>
                              <p className="font-body text-[9px] text-white/40">Due today, ready to route</p>
                            </div>
                            <div className="ml-2 flex items-center gap-1">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/[0.08] text-success" aria-label="Approve Send invoice">
                                <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                              </span>
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.03] text-white/45" aria-label="Deny Send invoice">
                                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                              </span>
                            </div>
                          </div>
                          <div className="gust-extraction-chip flex min-h-10 items-center px-2.5 py-2">
                            <div className="mr-2.5 flex h-6 w-6 items-center justify-center rounded-md bg-tertiary/[0.06]">
                              <svg className="h-3.5 w-3.5 text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4-4 3 3 7-7" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M20 8v6h-6" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-body text-[10px] font-semibold text-white">Buy groceries</p>
                              <p className="font-body text-[9px] text-white/40">Inbox item, reminders added</p>
                            </div>
                            <div className="ml-2 flex items-center gap-1">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/[0.08] text-success" aria-label="Approve Buy groceries">
                                <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                              </span>
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.03] text-white/45" aria-label="Deny Buy groceries">
                                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="absolute bottom-2 left-1/2 h-[4px] w-[120px] -translate-x-1/2 rounded-full bg-white/20 shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                    </div>
                  </div>
                </div>

                <div className="gust-floating-badge gust-floating-ui-badge absolute left-[-18px] top-6 z-30 flex items-center gap-3 rounded-xl p-3 lg:left-[-96px] lg:top-14 lg:gap-4 lg:rounded-2xl lg:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-secondary/30 bg-gradient-to-b from-secondary/20 to-secondary/5 lg:h-10 lg:w-10">
                    <svg className="h-4 w-4 text-secondary lg:h-5 lg:w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h7" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 7v10" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9l3 3-3 3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-body text-xs font-bold tracking-tight text-white lg:text-sm">
                      Desktop mode
                    </p>
                    <p className="font-body text-[10px] font-medium text-white/45 lg:text-xs">
                      More control and tailored analytics
                    </p>
                  </div>
                </div>

                <div className="gust-floating-badge gust-floating-ui-badge absolute right-[-26px] top-[208px] z-30 flex items-center gap-3 rounded-xl p-3 lg:right-[-116px] lg:top-[264px] lg:gap-4 lg:rounded-2xl lg:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-gradient-to-b from-primary/20 to-primary/5 lg:h-10 lg:w-10">
                    <svg className="h-4 w-4 text-primary lg:h-5 lg:w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h6" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h10" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16h8" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 7l3 3-3 3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-body text-xs font-bold tracking-tight text-white lg:text-sm">
                      AI task grouping
                    </p>
                    <p className="font-body text-[10px] font-medium text-white/45 lg:text-xs">
                      Sorted into the groups you already use
                    </p>
                  </div>
                </div>

                <div className="gust-floating-badge gust-floating-ui-badge absolute bottom-12 right-[-15px] z-30 flex items-center gap-3 rounded-xl p-3 lg:bottom-20 lg:right-[-80px] lg:gap-4 lg:rounded-2xl lg:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-tertiary/30 bg-gradient-to-b from-tertiary/20 to-tertiary/5 lg:h-10 lg:w-10">
                    <svg className="h-4 w-4 text-tertiary lg:h-5 lg:w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 5v14" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v10" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 3v16" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-body text-xs font-bold tracking-tight text-white lg:text-sm">
                      Daily or weekly updates
                    </p>
                    <p className="font-body text-[10px] font-medium text-white/45 lg:text-xs">
                      Opt in for what is done and what is left
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="gust-card-left-text order-3 z-20 flex w-full flex-col justify-center px-4 text-center lg:order-1 lg:px-0 lg:text-left">
              <h3 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl md:text-3xl lg:mb-5 lg:text-4xl">
                Voice-first task capture.
              </h3>
              <p className="mx-auto mt-3 max-w-[20rem] font-body text-sm leading-relaxed text-white/68 md:text-base lg:mx-0 lg:mt-0 lg:max-w-none lg:text-lg">
                Gust turns messy thoughts into structured tasks with groups, due dates, reminders,
                and review when confidence is low.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
