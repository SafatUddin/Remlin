import React, { useEffect, useRef } from 'react';
import { Tab } from '../types';

interface LandingPageProps {
  onNavigate: (tab: Tab) => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Ensure video plays even where autoplay is flaky
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    const tryPlay = () => video.play().catch(() => {});
    tryPlay();

    // Retry on first user interaction if browser blocked autoplay
    const handlers = ['click', 'touchstart', 'scroll'].map((evt) => {
      const handler = () => tryPlay();
      window.addEventListener(evt, handler, { once: true, passive: true });
      return { evt, handler };
    });

    // Pause when off-screen to save resources
    let observer: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => {
        entry.isIntersecting ? tryPlay() : video.pause();
      });
      observer.observe(video);
    }

    return () => {
      handlers.forEach(({ evt, handler }) => window.removeEventListener(evt, handler));
      observer?.disconnect();
    };
  }, []);

  // Responsive scaling for tablet/mobile
  useEffect(() => {
    const DESIGN_WIDTH = 1379;
    const SCANNER_WIDTH = 628.871;
    const FOOTER_ART_REACH = 901.5;

    function fitLayout() {
      const vw = document.documentElement.clientWidth;
      document.documentElement.style.setProperty('--fit', String(Math.min(1, vw / DESIGN_WIDTH)));
      document.documentElement.style.setProperty('--wide', String(Math.max(1, vw / 2 / FOOTER_ART_REACH)));

      const panel = document.querySelector('.demo-visual-panel') as HTMLElement;
      if (panel) {
        panel.style.setProperty('--vscale', String(panel.clientWidth / SCANNER_WIDTH));
      }
    }

    fitLayout();
    window.addEventListener('resize', fitLayout);
    return () => window.removeEventListener('resize', fitLayout);
  }, []);

  return (
    <div className="demo-landing-page">
      <style>{`
        .demo-landing-page {
          --demo-bg: #191919;
          --demo-text: #ffffff;
          --demo-text-muted: rgba(255, 255, 255, 0.6);
          --demo-nav-link: #a1a1aa;
          --demo-nav-border: #868690;
          --demo-frame-fill: #1a1a1a;
          font-family: "Inter Tight", system-ui, -apple-system, "Segoe UI", sans-serif;
          background: var(--demo-bg);
          color: var(--demo-text);
          min-height: 100vh;
          overflow-x: hidden;
        }

        /* Hero Section */
        .demo-hero {
          position: relative;
          height: 1071px;
          overflow: hidden;
        }

        .demo-hero__top {
          position: absolute;
          top: 55px;
          left: 50%;
          transform: translateX(-50%);
          width: 775px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 48px;
          z-index: 3;
        }

        /* Navbar */
        .demo-navbar {
          position: relative;
          width: 640px;
          padding: 8px 9px;
          border: 1.003px solid var(--demo-nav-border);
          border-radius: 86px;
          background: rgba(25, 25, 25, 0.2);
          box-shadow: 16px 17px 19.1px 0 rgba(0, 0, 0, 0.25), inset 0 0.669px 0 0 rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }

        .demo-navbar__inner {
          display: flex;
          align-items: center;
          gap: 100px;
        }

        .demo-navbar__logo {
          position: relative;
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          border: 1.16px solid var(--demo-nav-border);
          border-radius: 50%;
          background: var(--demo-bg);
          box-shadow: 18.5px 19.656px 22.084px 0 rgba(0, 0, 0, 0.25), inset 0 0.773px 0 0 rgba(255, 255, 255, 0.08);
          overflow: hidden;
          cursor: pointer;
        }

        .demo-navbar__logo img {
          position: absolute;
          left: 11.4px;
          top: 9.9px;
          width: 24.6px;
          height: 24.9px;
          display: block;
        }

        .demo-navbar__links {
          display: flex;
          align-items: center;
          gap: 18px;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: -0.13px;
          color: var(--demo-nav-link);
          white-space: nowrap;
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .demo-navbar__links a {
          color: inherit;
          text-decoration: none;
          transition: color 0.2s ease;
          cursor: pointer;
        }

        .demo-navbar__links a:hover {
          color: var(--demo-text);
        }

        .demo-navbar__actions {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        /* Navbar buttons run larger than the page's other .demo-btn instances */
        .demo-navbar .demo-btn { font-size: 11.5px; letter-spacing: -0.115px; }
        .demo-navbar .demo-btn--ghost { height: 36px; padding: 0 20px; line-height: 17px; }
        .demo-navbar .demo-btn--primary { width: 110px; padding: 10px; line-height: 14px; }

        /* Buttons */
        .demo-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: -0.09px;
          white-space: nowrap;
          overflow: hidden;
          transition: transform 0.2s ease, filter 0.2s ease;
          cursor: pointer;
          border: none;
          background: none;
        }

        .demo-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.08);
        }

        .demo-btn--ghost {
          height: 28px;
          padding: 0 16.05px;
          border: 0.669px solid rgba(228, 228, 231, 0.5);
          line-height: 13.375px;
          color: var(--demo-text);
          box-shadow: 0 1.337px 2.675px 0 rgba(0, 0, 0, 0.05);
        }

        .demo-btn--primary {
          width: 84px;
          padding: 8px;
          border: 0.794px solid rgba(255, 255, 255, 0.7);
          line-height: 10.624px;
          color: #000;
          background: linear-gradient(180deg, rgb(47, 157, 255) 0%, rgb(57, 163, 255) 9.71%, rgb(66, 170, 255) 19.43%, rgb(75, 176, 255) 29.14%, rgb(79, 179, 255) 34%, rgb(103, 189, 255) 43.43%, rgb(125, 198, 255) 52.86%, rgb(146, 208, 255) 62.29%, rgb(166, 217, 254) 71.71%, rgb(185, 226, 253) 81.14%, rgb(204, 235, 252) 90.57%, rgb(223, 244, 251) 100%);
          box-shadow: 0 0 28.595px 0 rgba(70, 160, 255, 0.55), 0 9.532px 25.418px 0 rgba(20, 90, 200, 0.45), inset 0 0.794px 0 0 rgba(255, 255, 255, 0.85);
        }

        .demo-btn--lg {
          width: auto;
          padding: 16.219px 26.674px;
          border-width: 1.61px;
          font-size: 18.247px;
          line-height: 21.539px;
          letter-spacing: -0.1825px;
          color: #191919;
          box-shadow: 0 0 57.974px 0 rgba(70, 160, 255, 0.55), 0 19.325px 51.532px 0 rgba(20, 90, 200, 0.45), inset 0 1.61px 0 0 rgba(255, 255, 255, 0.85);
        }

        .demo-btn--light {
          height: 48.75px;
          padding: 14px 24px;
          border: 1px solid rgba(255, 255, 255, 0.24);
          font-size: 17.786px;
          line-height: 20.995px;
          letter-spacing: -0.1779px;
          color: #191919;
          background: linear-gradient(180deg, #ffffff 0%, #f3f4f6 25%, #e7e9ec 50%, #dbdee3 75%, #cfd3da 100%);
          box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
          filter: drop-shadow(0 10px 13px rgba(0, 0, 0, 0.5));
        }

        .demo-btn--light:hover {
          filter: drop-shadow(0 10px 13px rgba(0, 0, 0, 0.5)) brightness(1.04);
        }

        .demo-btn--cta {
          width: auto;
          padding: 15.81px 26px;
          border-width: 1.57px;
          font-size: 17.786px;
          line-height: 20.995px;
          letter-spacing: -0.1779px;
          color: #191919;
          box-shadow: 0 0 56.509px 0 rgba(70, 160, 255, 0.55), 0 18.836px 50.23px 0 rgba(20, 90, 200, 0.45), inset 0 1.57px 0 0 rgba(255, 255, 255, 0.85);
        }

        .demo-btn--cta-light {
          height: 55.758px;
          filter: none;
          box-shadow: 0 10px 26px 0 rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
        }

        .demo-btn--cta-light:hover {
          filter: brightness(1.04);
        }

        /* Hero Copy */
        .demo-hero__copy {
          width: 597px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          text-align: center;
        }

        .demo-hero__title {
          margin: 0;
          font-size: 62px;
          font-weight: 600;
          line-height: normal;
          letter-spacing: -2.48px;
          white-space: nowrap;
        }

        .demo-hero__subtitle {
          margin: 0;
          width: 619px;
          font-size: 20px;
          font-weight: 300;
          line-height: normal;
          letter-spacing: -0.8px;
          color: var(--demo-text-muted);
        }

        .demo-hero__subtitle strong {
          font-weight: 500;
          color: var(--demo-text);
        }

        /* Video Frame */
        .demo-hero__video-frame {
          position: absolute;
          top: 479px;
          left: calc(50% - 387.5px);
          width: 763px;
          height: 437.85px;
          border-radius: 35px;
          background: var(--demo-frame-fill);
          overflow: hidden;
          z-index: 1;
        }

        .demo-hero__video {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }

        /* Landscape Overlay */
        .demo-hero__landscape {
          position: absolute;
          top: 669px;
          left: calc(50% - 1121.5px);
          width: 2176px;
          height: 402px;
          max-width: none;
          object-fit: cover;
          pointer-events: none;
          user-select: none;
          z-index: 2;
        }

        /* Page Container */
        .demo-page {
          width: 1285px;
          margin: 0 auto;
        }

        /* Stats Section */
        .demo-stats {
          position: relative;
          height: 538px;
          margin-top: 10px;
          background: transparent;
        }

        .demo-stats__frame {
          position: absolute;
          top: 88px;
          left: -2px;
          width: 1296px;
          height: 361.769px;
          border: 1.034px solid #5b5b5b;
          background: var(--demo-bg);
        }

        .demo-stats__stripes {
          --lw: calc(var(--w) * 0.08);
          --t: calc(var(--lw) * 0.149);
          position: absolute;
          width: var(--w);
          background-color: #191919;
          background-image: linear-gradient(to bottom, transparent calc(50% - var(--t) / 2), #2e2e2e calc(50% - var(--t) / 2), #2e2e2e calc(50% + var(--t) / 2), transparent calc(50% + var(--t) / 2));
          background-size: 100% var(--lw);
          background-position: center;
          background-repeat: repeat-y;
        }

        .demo-stats__stripes--left {
          --w: 266.676px;
          left: 0;
          top: 1.03px;
          height: 358.669px;
        }

        .demo-stats__stripes--right {
          --w: 265px;
          left: 1022.97px;
          top: 0.85px;
          height: 359px;
        }

        .demo-stats__grid {
          position: absolute;
          left: 263.61px;
          top: -1px;
          width: 761.065px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .demo-stats__row {
          display: flex;
          width: 760.06px;
          margin-bottom: -1.039px;
        }

        .demo-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10.392px;
          border: 1.039px solid #5b5b5b;
          text-align: center;
          font-weight: 600;
          line-height: normal;
          overflow: hidden;
          background: var(--demo-bg);
        }

        .demo-stat--1, .demo-stat--2 {
          width: 254.598px;
          height: 178.739px;
          margin-right: -1.039px;
        }

        .demo-stat--1 { padding-top: 33.25px; }
        .demo-stat--2 { padding-top: 32.21px; }

        .demo-stat--3 {
          width: 253.353px;
          height: 178.956px;
          padding-top: 32.21px;
        }

        .demo-stat--wide {
          width: 100%;
          height: 183.934px;
          padding-top: 28.06px;
        }

        .demo-stat__value {
          font-size: 64.429px;
          letter-spacing: -2.5772px;
          color: var(--demo-text);
          white-space: nowrap;
          margin: 0;
        }

        .demo-stat__label {
          font-size: 20.784px;
          letter-spacing: -0.8313px;
          color: #a3a3a3;
          white-space: nowrap;
          margin: 0;
        }

        /* Section Heading */
        .demo-section-head {
          width: 597px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
          line-height: normal;
          margin: 0 auto;
        }

        .demo-section-head__title {
          font-size: 62px;
          font-weight: 600;
          letter-spacing: -2.48px;
          white-space: nowrap;
          margin: 0;
        }

        .demo-section-head__subtitle {
          width: 619px;
          font-size: 20px;
          font-weight: 300;
          letter-spacing: -0.8px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        /* Suite Section */
        .demo-suite {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 90px;
        }

        .demo-suite__rows {
          display: flex;
          flex-direction: column;
        }

        .demo-feature {
          position: relative;
          width: 1285px;
          height: 318.33px;
          border: 0.973px solid #5b5b5b;
          overflow: hidden;
        }

        .demo-feature + .demo-feature {
          margin-top: -0.973px;
        }

        .demo-feature__text {
          position: absolute;
          display: flex;
          flex-direction: column;
          gap: 13.629px;
          line-height: normal;
        }

        .demo-feature__text--always { left: 132.39px; top: 73.01px; width: 377.712px; gap: 13.09px; }
        .demo-feature__text--visual { left: 132.39px; top: 79.83px; width: 377.712px; }
        .demo-feature__text--checkout { left: 736.93px; top: 88.59px; width: 407.89px; }

        .demo-feature__title {
          font-size: 46.727px;
          font-weight: 600;
          letter-spacing: -1.8691px;
          white-space: nowrap;
          margin: 0;
        }

        .demo-feature__desc {
          font-size: 19.47px;
          font-weight: 300;
          letter-spacing: -0.7788px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        .demo-feature__media {
          position: absolute;
          top: -0.973px;
          height: 318.33px;
          border: 0.973px solid #5b5b5b;
          overflow: hidden;
        }

        .demo-feature__media--right { left: 655.16px; width: 628.871px; }
        .demo-feature__media--left { left: -0.973px; width: 657.102px; }

        .demo-feature__media img {
          position: absolute;
          display: block;
          max-width: none;
          object-fit: cover;
          pointer-events: none;
        }

        .demo-img-always { left: -28.23px; top: -36.02px; width: 655.157px; height: 353.374px; }
        .demo-img-checkout { left: -18.5px; top: 0.97px; width: 691.761px; height: 314.612px; }

        /* Visual Intelligence */
        .demo-feature__media--visual {
          background: #242424;
        }

        .demo-visual__stage {
          position: absolute;
          left: 0;
          top: 0;
          width: 628.871px;
          height: 318.33px;
          transform-origin: 0 0;
        }

        .demo-visual__bg {
          position: absolute;
          left: -8.76px;
          top: -10.71px;
          width: 668.784px;
          height: 342.667px;
          overflow: hidden;
        }

        .demo-visual__bg img {
          position: absolute;
          left: 0;
          top: -0.04%;
          width: 100%;
          height: 98.66%;
          object-fit: fill;
        }

        .demo-visual__tile {
          position: absolute;
          background: #242424;
          overflow: hidden;
        }

        .demo-visual__tile--watch { left: 27.26px; top: 81.77px; width: 153.811px; height: 153.811px; }
        .demo-visual__tile--headphones { left: 437.1px; top: 81.77px; width: 153.811px; height: 153.811px; }
        .demo-visual__tile--shoe { left: 211.25px; top: 50.62px; width: 202.485px; height: 202.485px; }

        .demo-visual__tile--watch img { position: absolute; left: 12.64px; top: 12.56px; width: 128px; height: 128px; }
        .demo-visual__tile--headphones img { position: absolute; left: 18.5px; top: 21.42px; width: 110.977px; height: 110.977px; }

        .demo-visual__shoe-wrap {
          position: absolute;
          left: -74.96px;
          top: -63.28px;
          width: 309.482px;
          height: 286.468px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .demo-visual__shoe-wrap img {
          position: relative;
          flex: none;
          width: 253.063px;
          height: 178.848px;
          transform: rotate(-32.33deg);
        }

        .demo-visual__corner {
          position: absolute;
          width: 12.169px;
          height: 12.169px;
        }

        .demo-visual__corner img {
          position: absolute;
          top: -12%;
          left: -12%;
          width: 112%;
          height: 112%;
          object-fit: fill;
        }

        .demo-visual__corner--tl { left: 203.46px; top: 43.81px; }
        .demo-visual__corner--bl { left: 203.46px; top: 247.26px; transform: scaleY(-1); }
        .demo-visual__corner--tr { left: 407.4px; top: 43.81px; transform: scaleX(-1); }
        .demo-visual__corner--br { left: 407.4px; top: 247.26px; transform: rotate(180deg); }

        .demo-visual__scan-glow {
          position: absolute;
          left: 203.46px;
          top: 76.9px;
          width: 216.114px;
          height: 77.879px;
          background: linear-gradient(to bottom, rgba(64, 207, 255, 0), #40cfff);
        }

        .demo-visual__scan-line,
        .demo-visual__scan-tick {
          position: absolute;
          background: #0084ff;
        }

        .demo-visual__scan-line { left: 203.46px; top: 152.84px; width: 216.114px; height: 1.947px; }
        .demo-visual__scan-tick--r { left: 417.62px; top: 147px; width: 1.947px; height: 12.655px; }
        .demo-visual__scan-tick--l { left: 203.46px; top: 147.97px; width: 1.947px; height: 12.655px; }

        /* Unified Command */
        .demo-unified {
          width: 1271.846px;
          height: 520.033px;
          margin: 0 auto;
          padding: 136.448px 131.318px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 107.722px;
        }

        .demo-unified__copy {
          flex-shrink: 0;
          width: 387.504px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 23.596px;
        }

        .demo-unified__text {
          display: flex;
          flex-direction: column;
          gap: 13.337px;
          line-height: normal;
        }

        .demo-unified__title {
          font-size: 47.939px;
          font-weight: 600;
          letter-spacing: -1.9175px;
          margin: 0;
        }

        .demo-unified__desc {
          font-size: 19.974px;
          font-weight: 300;
          letter-spacing: -0.799px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        .demo-channels {
          position: relative;
          flex-shrink: 0;
          width: 513.982px;
          padding: 11.761px;
          border: 1.18px solid var(--demo-nav-border);
          border-radius: 117.614px;
          background: rgba(25, 25, 25, 0.2);
          box-shadow: 18.818px 19.994px 22.464px 0 rgba(0, 0, 0, 0.25), inset 0 0.787px 0 0 rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .demo-channels__inner {
          display: flex;
          align-items: center;
          gap: 27.051px;
        }

        .demo-channel {
          position: relative;
          flex-shrink: 0;
          width: 144.666px;
          height: 144.666px;
          border: 1.18px solid var(--demo-nav-border);
          border-radius: 50%;
          background: rgba(25, 25, 25, 0.2);
          box-shadow: 18.818px 19.994px 22.464px 0 rgba(0, 0, 0, 0.25), inset 0 0.787px 0 0 rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        .demo-channel__icon {
          position: absolute;
          display: block;
          max-width: none;
        }

        .demo-channel__icon--whatsapp { left: 31.75px; top: 27.05px; width: 81.072px; height: 81.705px; }
        .demo-channel__icon--messenger { left: 34.1px; top: 34.1px; width: 76.449px; height: 76.449px; }
        .demo-channel__icon--instagram { left: 34.1px; top: 31.75px; width: 75.273px; height: 75.273px; }

        /* Pricing */
        .demo-pricing {
          width: 1271.846px;
          margin: 0 auto;
          padding: 96px 0 40px;
          display: flex;
          flex-direction: column;
          gap: 40px;
          scroll-margin-top: 24px;
        }

        .demo-pricing__head {
          display: flex;
          flex-direction: column;
          gap: 13.337px;
          max-width: 640px;
        }

        .demo-pricing__title {
          font-size: 47.939px;
          font-weight: 600;
          letter-spacing: -1.9175px;
          line-height: normal;
          margin: 0;
        }

        .demo-pricing__desc {
          font-size: 19.974px;
          font-weight: 300;
          letter-spacing: -0.799px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        .demo-pricing__grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .demo-plan {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 28px 24px;
          border: 1px solid #3a3a3a;
          background: rgba(25, 25, 25, 0.2);
        }

        .demo-plan--best {
          border-color: var(--demo-nav-border);
          box-shadow: inset 0 0.787px 0 0 rgba(255, 255, 255, 0.08);
        }

        .demo-plan__tag {
          position: absolute;
          top: 14px;
          right: 14px;
          padding: 3px 10px;
          border: 1px solid var(--demo-nav-border);
          border-radius: 999px;
          font-size: 12px;
          color: var(--demo-nav-link);
        }

        .demo-plan__label {
          font-size: 15px;
          color: var(--demo-text-muted);
        }

        .demo-plan__price {
          font-size: 38px;
          font-weight: 600;
          letter-spacing: -1.4px;
        }

        .demo-plan__bonus {
          font-size: 15px;
          color: var(--demo-nav-link);
          min-height: 22px;
        }

        .demo-plan__rows {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #2e2e2e;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 15px;
          color: var(--demo-text-muted);
        }

        .demo-plan__rows strong {
          color: var(--demo-text);
          font-weight: 500;
        }

        .demo-pricing__lower {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .demo-pricing__box {
          padding: 28px 24px;
          border: 1px solid #3a3a3a;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .demo-pricing__box h3 {
          margin: 0;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.6px;
        }

        .demo-pricing__box ul {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 15px;
          line-height: 1.5;
          color: var(--demo-text-muted);
        }

        .demo-pricing__note {
          font-size: 14px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        /* Predictive */
        .demo-predictive {
          position: relative;
          width: 1379px;
          height: 382px;
          margin: 20px auto 0;
          border: 1px solid #3a3a3a;
        }

        .demo-predictive__box {
          position: absolute;
          left: 196px;
          top: -1px;
          width: 970px;
          height: 382px;
          border: 1px solid #3a3a3a;
          overflow: hidden;
        }

        .demo-predictive__copy {
          position: absolute;
          left: 43px;
          top: 46px;
          width: 377.712px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 28px;
          z-index: 1;
        }

        .demo-predictive__text {
          display: flex;
          flex-direction: column;
          gap: 13px;
          line-height: normal;
        }

        .demo-predictive__title {
          width: 407px;
          font-size: 46.727px;
          font-weight: 600;
          letter-spacing: -1.8691px;
          margin: 0;
        }

        .demo-predictive__desc {
          max-width: 374px;
          font-size: 19.47px;
          font-weight: 300;
          letter-spacing: -0.7788px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        .demo-predictive__chart {
          position: absolute;
          left: 373px;
          top: 56px;
          width: 865.542px;
          height: 343.307px;
          max-width: none;
          transform: rotate(180deg);
          pointer-events: none;
        }

        /* Footer */
        .demo-footer {
          position: relative;
          height: 524px;
          overflow: hidden;
        }

        .demo-footer__copy {
          position: absolute;
          left: calc(50% - 475.5px);
          top: 102.15px;
          width: 387.712px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 21px;
          z-index: 1;
        }

        .demo-footer__text {
          display: flex;
          flex-direction: column;
          gap: 13px;
          line-height: normal;
        }

        .demo-footer__title {
          width: 359px;
          font-size: 46.727px;
          font-weight: 600;
          letter-spacing: -1.8691px;
          margin: 0;
        }

        .demo-footer__desc {
          font-size: 19.47px;
          font-weight: 300;
          letter-spacing: -0.7788px;
          color: var(--demo-text-muted);
          margin: 0;
        }

        .demo-footer__actions {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .demo-footer__landscape {
          position: absolute;
          left: calc(50% - 1047.5px);
          top: -149px;
          width: 1995px;
          height: 705px;
          overflow: hidden;
          pointer-events: none;
          transform: scale(var(--wide, 1));
          transform-origin: 1047.5px 673px;
        }

        .demo-footer__landscape img {
          position: absolute;
          left: -2.06%;
          top: -13.65%;
          width: 99.75%;
          height: 113.68%;
          max-width: none;
        }

        /* Responsive */
        @media (min-width: 821px) and (max-width: 1379px) {
          .demo-page,
          .demo-footer,
          .demo-predictive {
            zoom: var(--fit, 1);
          }
        }

        @media (max-width: 820px) {
          .demo-hero {
            height: auto;
            padding: 32px 16px 0;
          }

          .demo-hero__top {
            position: relative;
            top: 0;
            left: 0;
            transform: none;
            width: 100%;
            gap: 36px;
          }

          .demo-navbar {
            width: 100%;
            max-width: 491px;
          }

          .demo-navbar__inner {
            justify-content: space-between;
            gap: 12px;
          }

          .demo-navbar__links {
            display: none;
          }

          .demo-hero__copy,
          .demo-hero__subtitle {
            width: 100%;
          }

          .demo-hero__title {
            font-size: clamp(32px, 8.5vw, 62px);
            letter-spacing: -0.04em;
            white-space: normal;
          }

          .demo-hero__subtitle {
            font-size: 16px;
          }

          .demo-hero__video-frame {
            position: relative;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: min(92vw, 763px);
            height: auto;
            aspect-ratio: 763 / 437.85;
            margin-top: 48px;
            border-radius: min(4.2vw, 35px);
          }

          .demo-hero__landscape {
            position: relative;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 220vw;
            height: auto;
            margin-top: -22vw;
          }

          .demo-page {
            width: 100%;
            padding: 0 16px;
          }

          .demo-pricing {
            width: 100%;
            padding: 64px 0 24px;
            gap: 28px;
          }

          .demo-pricing__title {
            font-size: 36px;
            letter-spacing: -1.4px;
          }

          .demo-pricing__desc {
            font-size: 17px;
          }

          .demo-pricing__grid,
          .demo-pricing__lower {
            grid-template-columns: 1fr;
          }

          .demo-stats {
            height: auto;
            padding: 48px 0;
          }

          .demo-stats__frame {
            position: static;
            width: 100%;
            height: auto;
            border: 0;
          }

          .demo-stats__stripes {
            display: none;
          }

          .demo-stats__grid {
            position: static;
            width: 100%;
          }

          .demo-stats__row {
            width: 100%;
          }

          .demo-stat,
          .demo-stat--wide {
            width: 100%;
            height: auto;
            padding: 24px 8px;
          }

          .demo-stat--1,
          .demo-stat--2,
          .demo-stat--3 {
            flex: 1 1 0;
            width: auto;
          }

          .demo-stat__value {
            font-size: clamp(26px, 8vw, 64px);
            letter-spacing: -0.04em;
          }

          .demo-stat__label {
            font-size: 13px;
            letter-spacing: -0.02em;
          }

          .demo-suite {
            gap: 40px;
          }

          .demo-section-head,
          .demo-section-head__subtitle {
            width: 100%;
          }

          .demo-section-head__title {
            font-size: clamp(32px, 9vw, 62px);
            white-space: normal;
          }

          .demo-section-head__subtitle {
            font-size: 16px;
          }

          .demo-suite__rows {
            width: 100%;
          }

          .demo-feature {
            width: 100%;
            height: auto;
            display: flex;
            flex-direction: column;
          }

          .demo-feature__text,
          .demo-feature__text--always,
          .demo-feature__text--visual,
          .demo-feature__text--checkout {
            position: static;
            width: auto;
            padding: 32px 20px;
            order: 1;
          }

          .demo-feature__title {
            font-size: 32px;
            white-space: normal;
          }

          .demo-feature__desc {
            font-size: 16px;
          }

          .demo-feature__media,
          .demo-feature__media--left,
          .demo-feature__media--right {
            position: relative;
            left: 0;
            top: 0;
            width: 100%;
            height: auto;
            aspect-ratio: 628.871 / 318.33;
            border-width: 0.973px 0 0;
            order: 2;
          }

          .demo-img-always,
          .demo-img-checkout {
            inset: 0;
            width: 100%;
            height: 100%;
          }

          .demo-visual__stage {
            transform: scale(var(--vscale, 1));
          }

          .demo-unified {
            width: 100%;
            height: auto;
            padding: 64px 16px;
            flex-direction: column;
            align-items: flex-start;
            gap: 48px;
          }

          .demo-unified__copy {
            width: 100%;
          }

          .demo-unified__title {
            font-size: 34px;
          }

          .demo-unified__desc {
            font-size: 16px;
          }

          .demo-channels {
            width: 100%;
            max-width: 514px;
            align-self: center;
            padding: 8px;
          }

          .demo-channels__inner {
            justify-content: space-between;
            gap: 8px;
          }

          .demo-channel {
            flex: 1 1 0;
            width: auto;
            height: auto;
            aspect-ratio: 1;
          }

          .demo-channel__icon,
          .demo-channel__icon--whatsapp,
          .demo-channel__icon--messenger,
          .demo-channel__icon--instagram {
            left: 22%;
            top: 22%;
            width: 56%;
            height: 56%;
          }

          .demo-predictive {
            width: auto;
            height: 480px;
            margin: 20px 16px 0;
          }

          .demo-predictive__box {
            left: -1px;
            width: calc(100% + 2px);
            height: 480px;
          }

          .demo-predictive__copy {
            left: 20px;
            top: 32px;
            width: calc(100% - 40px);
          }

          .demo-predictive__title {
            width: 100%;
            font-size: 32px;
          }

          .demo-predictive__desc {
            font-size: 16px;
          }

          .demo-predictive__chart {
            left: -300px;
            top: 230px;
          }

          .demo-footer {
            width: 100%;
            height: auto;
            padding: 56px 16px 0;
          }

          .demo-footer__copy {
            position: relative;
            left: 0;
            top: 0;
            width: 100%;
          }

          .demo-footer__title {
            width: 100%;
            font-size: 34px;
          }

          .demo-footer__desc {
            font-size: 16px;
          }

          .demo-footer__actions {
            flex-wrap: wrap;
          }

          .demo-footer__landscape {
            position: relative;
            left: 50%;
            top: 0;
            width: 180vw;
            height: auto;
            aspect-ratio: 1995 / 705;
            margin-top: -12vw;
            transform: translateX(-60%);
            transform-origin: 50% 50%;
          }
        }
      `}</style>

      {/* Hero Section */}
      <section className="demo-hero" id="top">
        <div className="demo-hero__top">
          <nav className="demo-navbar">
            <div className="demo-navbar__inner">
              <div className="demo-navbar__logo" onClick={() => onNavigate('landing')}>
                <img src="/assets/logo.svg" alt="Remlin" />
              </div>
              <ul className="demo-navbar__links">
                <li><a href="#top">Product</a></li>
                <li><a href="#pricing">Pricing</a></li>
                <li><a href="#features">Features</a></li>
              </ul>
              <div className="demo-navbar__actions">
                <button className="demo-btn demo-btn--ghost" onClick={() => onNavigate('login')}>
                  Sign in
                </button>
                <button className="demo-btn demo-btn--primary" onClick={() => onNavigate('signup')}>
                  Start for free
                </button>
              </div>
            </div>
          </nav>

          <div className="demo-hero__copy">
            <h1 className="demo-hero__title">Turn every message<br />into a sale with Remlin</h1>
            <p className="demo-hero__subtitle">
              The AI sales agent for <strong>Facebook, Instagram, and WhatsApp</strong>.<br />
              Multilingual, image-aware, and always active to close deals while you sleep.
            </p>
          </div>
        </div>

        <div className="demo-hero__video-frame">
          <video ref={videoRef} className="demo-hero__video" autoPlay muted loop playsInline preload="auto">
            <source src="/hero-video.mp4" type="video/mp4" />
          </video>
        </div>

        <img className="demo-hero__landscape" src="/assets/grass.png" alt="" aria-hidden="true" />
      </section>

      <div className="demo-page">
        {/* Stats Section */}
        <section className="demo-stats">
          <div className="demo-stats__frame">
            <div className="demo-stats__stripes demo-stats__stripes--left" aria-hidden="true" />
            <div className="demo-stats__stripes demo-stats__stripes--right" aria-hidden="true" />

            <div className="demo-stats__grid">
              <div className="demo-stats__row">
                <div className="demo-stat demo-stat--1">
                  <p className="demo-stat__value">98%</p>
                  <p className="demo-stat__label">Inquiry accuracy</p>
                </div>
                <div className="demo-stat demo-stat--2">
                  <p className="demo-stat__value">3.2x</p>
                  <p className="demo-stat__label">Sales conversion</p>
                </div>
                <div className="demo-stat demo-stat--3">
                  <p className="demo-stat__value">24/7</p>
                  <p className="demo-stat__label">Always online</p>
                </div>
              </div>
              <div className="demo-stat demo-stat--wide">
                <p className="demo-stat__value">Multilingual support</p>
                <p className="demo-stat__label">Bangla, English and Banglish</p>
              </div>
            </div>
          </div>
        </section>

        {/* Elite Sales Suite */}
        <section className="demo-suite" id="features">
          <header className="demo-section-head">
            <h2 className="demo-section-head__title">The elite sales suite</h2>
            <p className="demo-section-head__subtitle">Engineered for high-volume commerce and precision automation.</p>
          </header>

          <div className="demo-suite__rows">
            {/* Always On */}
            <article className="demo-feature">
              <div className="demo-feature__text demo-feature__text--always">
                <h3 className="demo-feature__title">Always on</h3>
                <p className="demo-feature__desc">
                  Talks to customers autonomously and even confirms and places product orders and you don't have to intervene. 
                  You can always take over and turn Remlin off whenever you want to.
                </p>
              </div>
              <div className="demo-feature__media demo-feature__media--right">
                <img className="demo-img-always" src="/assets/always-on.png" alt="Laptop showing a Remlin chat in a pixel-art meadow" />
              </div>
            </article>

            {/* One-Click Checkout */}
            <article className="demo-feature">
              <div className="demo-feature__media demo-feature__media--left">
                <img className="demo-img-checkout" src="/assets/checkout.png" alt="Shoppers on their phones with parcels parachuting over a city" />
              </div>
              <div className="demo-feature__text demo-feature__text--checkout">
                <h3 className="demo-feature__title">One-click checkout</h3>
                <p className="demo-feature__desc">
                  Don't lose customers to friction. Generate secure payment links directly within the chat window instantly.
                </p>
              </div>
            </article>

            {/* Visual Intelligence */}
            <article className="demo-feature">
              <div className="demo-feature__text demo-feature__text--visual">
                <h3 className="demo-feature__title">Visual intelligence</h3>
                <p className="demo-feature__desc">
                  Our neural engine identifies products from customer photos in real-time. Stop asking for SKUs; Remlin knows exactly what they want.
                </p>
              </div>
              <div className="demo-feature__media demo-feature__media--right demo-feature__media--visual demo-visual-panel">
                <div className="demo-visual__stage">
                  <div className="demo-visual__bg">
                    <img src="/assets/visual-bg.png" alt="" />
                  </div>

                  <div className="demo-visual__tile demo-visual__tile--watch">
                    <img src="/assets/product-watch.png" alt="Wristwatch" />
                  </div>
                  <div className="demo-visual__tile demo-visual__tile--headphones">
                    <img src="/assets/product-headphones.png" alt="Headphones" />
                  </div>
                  <div className="demo-visual__tile demo-visual__tile--shoe">
                    <div className="demo-visual__shoe-wrap">
                      <img src="/assets/product-shoe.png" alt="Sneaker" />
                    </div>
                  </div>

                  <span className="demo-visual__corner demo-visual__corner--tl">
                    <img src="/assets/corner-a.svg" alt="" />
                  </span>
                  <span className="demo-visual__corner demo-visual__corner--bl">
                    <img src="/assets/corner-a.svg" alt="" />
                  </span>
                  <span className="demo-visual__corner demo-visual__corner--tr">
                    <img src="/assets/corner-b.svg" alt="" />
                  </span>
                  <span className="demo-visual__corner demo-visual__corner--br">
                    <img src="/assets/corner-b.svg" alt="" />
                  </span>

                  <span className="demo-visual__scan-glow" />
                  <span className="demo-visual__scan-line" />
                  <span className="demo-visual__scan-tick demo-visual__scan-tick--r" />
                  <span className="demo-visual__scan-tick demo-visual__scan-tick--l" />
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* Unified Command */}
        <section className="demo-unified">
          <div className="demo-unified__copy">
            <div className="demo-unified__text">
              <h2 className="demo-unified__title">Unified command</h2>
              <p className="demo-unified__desc">
                One elite dashboard for Facebook, Instagram, and WhatsApp. Centralize your inventory, customer data, 
                and sales analytics into a single source of truth.
              </p>
            </div>
            <button className="demo-btn demo-btn--primary demo-btn--lg" onClick={() => onNavigate('login')}>
              Open the console →
            </button>
          </div>

          <div className="demo-channels">
            <div className="demo-channels__inner">
              <div className="demo-channel">
                <img className="demo-channel__icon demo-channel__icon--whatsapp" src="/assets/icon-whatsapp.svg" alt="WhatsApp" />
              </div>
              <div className="demo-channel">
                <img className="demo-channel__icon demo-channel__icon--messenger" src="/assets/icon-messenger.svg" alt="Messenger" />
              </div>
              <div className="demo-channel">
                <img className="demo-channel__icon demo-channel__icon--instagram" src="/assets/icon-instagram.svg" alt="Instagram" />
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="demo-pricing" id="pricing">
          <div className="demo-pricing__head">
            <h2 className="demo-pricing__title">Simple, pay-as-you-go pricing</h2>
            <p className="demo-pricing__desc">
              10 paisa per AI reply. Prepaid wallet. No commission, no monthly fee. Top up more, get bonus credit.
            </p>
          </div>

          <div className="demo-pricing__grid">
            {[
              { topup: '300', bonus: 'Minimum top-up', credit: '300', rate: '10.0', replies: '3,000', best: false },
              { topup: '1,000', bonus: '+10% bonus', credit: '1,100', rate: '9.1', replies: '11,000', best: false },
              { topup: '2,500', bonus: '+20% bonus', credit: '3,000', rate: '8.3', replies: '30,000', best: false },
              { topup: '5,000', bonus: '+25% bonus', credit: '6,250', rate: '8.0', replies: '62,500', best: true },
            ].map((plan) => (
              <article key={plan.topup} className={`demo-plan${plan.best ? ' demo-plan--best' : ''}`}>
                {plan.best && <span className="demo-plan__tag">Best value</span>}
                <span className="demo-plan__label">Top up</span>
                <span className="demo-plan__price">৳{plan.topup}</span>
                <span className="demo-plan__bonus">{plan.bonus}</span>
                <div className="demo-plan__rows">
                  <span>You get <strong>৳{plan.credit}</strong> credit</span>
                  <span><strong>{plan.replies}</strong> AI replies</span>
                  <span>Effective <strong>{plan.rate} paisa</strong> per reply</span>
                </div>
              </article>
            ))}
          </div>

          <div className="demo-pricing__lower">
            <div className="demo-pricing__box">
              <h3>Try it free first</h3>
              <ul>
                <li>14 days or 100 conversations (about 800 replies), whichever comes first.</li>
                <li>No payment needed and no commission.</li>
                <li>One trial per Facebook Page and per verified phone number.</li>
                <li>When the trial ends, chats are handed to you with a notice, never left unanswered. You also get a summary of conversations handled and replies sent.</li>
              </ul>
              <div>
                <button className="demo-btn demo-btn--primary demo-btn--lg" onClick={() => onNavigate('signup')}>
                  Start free trial →
                </button>
              </div>
            </div>

            <div className="demo-pricing__box">
              <h3>What counts as a reply</h3>
              <ul>
                <li>One billable reply is one AI message sent to a customer.</li>
                <li>Not charged: handoffs to a human and messages that fail to send.</li>
                <li>A reply to an image or a voice note counts as 2 replies.</li>
                <li>Credit is valid for 90 days from top-up.</li>
                <li>Low-balance alert with a one-tap bKash or Nagad top-up link. If you run out, a 100-reply buffer keeps customers served while you top up.</li>
              </ul>
              <p className="demo-pricing__note">Pay with bKash, Nagad or Rocket.</p>
            </div>
          </div>
        </section>
      </div>

      {/* Predictive Inventory */}
      <section className="demo-predictive">
        <div className="demo-predictive__box">
          <div className="demo-predictive__copy">
            <div className="demo-predictive__text">
              <h2 className="demo-predictive__title">Predictive inventory management</h2>
              <p className="demo-predictive__desc">
                Remlin doesn't just talk; it thinks. It analyzes chat trends to predict high-demand items before they go out of stock, 
                giving you a competitive edge.
              </p>
            </div>
            <button className="demo-btn demo-btn--light" onClick={() => onNavigate('login')}>
              Explore Insights →
            </button>
          </div>
          <img className="demo-predictive__chart" src="/assets/chart.svg" alt="" aria-hidden="true" />
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="demo-footer">
        <div className="demo-footer__copy">
          <div className="demo-footer__text">
            <h2 className="demo-footer__title">Ready to scale your sales?</h2>
            <p className="demo-footer__desc">No credit card required · 14-day free trial</p>
          </div>
          <div className="demo-footer__actions">
            <button className="demo-btn demo-btn--primary demo-btn--cta" onClick={() => onNavigate('signup')}>
              Get started for free
            </button>
            <button className="demo-btn demo-btn--light demo-btn--cta-light">
              Schedule a call
            </button>
          </div>
        </div>
        <div className="demo-footer__landscape" aria-hidden="true">
          <img src="/assets/footer-landscape.png" alt="" />
        </div>
      </footer>
    </div>
  );
}
