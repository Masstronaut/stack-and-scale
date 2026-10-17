<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Motion } from "motion-v";
import { onSlideEnter } from "@slidev/client";
import DocSheet from "./DocSheet.vue";

interface DocDef {
  name: string;
  x: number;
  y: number;
  rot: number;
  color: string;
}

const docs: DocDef[] = [
  { name: "MSA — Acme Corp.pdf", x: 24, y: 8, rot: -7, color: "#f59e0b" },
  { name: "Order Form #2041.pdf", x: 148, y: 24, rot: 5, color: "#38bdf8" },
  { name: "NDA — Initech.pdf", x: 272, y: 6, rot: -3, color: "#a78bfa" },
  { name: "SOW — Globex.pdf", x: 396, y: 22, rot: 8, color: "#34d399" },
  { name: "MSA — Stark Ind..pdf", x: 520, y: 8, rot: -5, color: "#f59e0b" },
  { name: "Security review.pdf", x: 40, y: 140, rot: 6, color: "#f472b6" },
  { name: "Invoice #905.pdf", x: 168, y: 152, rot: -6, color: "#38bdf8" },
  { name: "Renewal Q3 — Acme.pdf", x: 296, y: 138, rot: 4, color: "#f59e0b" },
  { name: "Pricing v2.xlsx", x: 424, y: 150, rot: -8, color: "#a78bfa" },
  { name: "Support notes.docx", x: 548, y: 136, rot: 5, color: "#94a3b8" },
  { name: "Contract — Hooli.pdf", x: 90, y: 270, rot: -4, color: "#f59e0b" },
  { name: "Amendment #2.pdf", x: 230, y: 280, rot: 7, color: "#34d399" },
  { name: "Order Form #1877.pdf", x: 380, y: 268, rot: -6, color: "#f59e0b" },
];

const BOX_X = 798;
const BOX_Y = 152;
const FLY_AT = 1.6;
const FLY_STAGGER = 0.14;

const flying = ref(false);
const arrived = ref(0);
const showChip = ref(false);
const allIn = computed(() => arrived.value === docs.length);

let timers: ReturnType<typeof setTimeout>[] = [];
const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function play() {
  clearTimers();
  flying.value = false;
  arrived.value = 0;
  showChip.value = false;
  later(() => (flying.value = true), FLY_AT * 1000);
  docs.forEach((_, i) =>
    later(() => (arrived.value = i + 1), (FLY_AT + i * FLY_STAGGER + 0.55) * 1000),
  );
  later(() => (showChip.value = true), 4000);
}

onMounted(play);
onSlideEnter(play);
onUnmounted(clearTimers);

function docStyle(d: DocDef) {
  return { left: `${d.x}px`, top: `${d.y}px` };
}

function flightDelta(d: DocDef) {
  return { x: BOX_X - (d.x + 36), y: BOX_Y - (d.y + 28) };
}
</script>

<template>
  <div class="stage-root">
    <div class="deco deco-amber" />
    <div class="deco deco-blue" />

    <div class="header">
      <Motion
        :initial="{ opacity: 0, y: -10 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
      >
        <h1 class="title">Everything starts in <span class="accent">Box</span></h1>
        <p class="subtitle">
          Contracts, order forms, invoices, NDAs — the customer document library lands in Box.
        </p>
      </Motion>
    </div>

    <div class="scene">
      <!-- flying documents -->
      <Motion
        v-for="(d, i) in docs"
        :key="i"
        class="doc"
        :style="docStyle(d)"
        :initial="{ opacity: 0, scale: 0.3, rotate: d.rot - 16, x: 0, y: 0 }"
        :animate="
          flying
            ? { opacity: 0, scale: 0.22, rotate: 0, ...flightDelta(d) }
            : { opacity: 1, scale: 1, rotate: d.rot, x: 0, y: 0 }
        "
        :transition="
          flying
            ? { delay: FLY_AT + i * FLY_STAGGER, duration: 0.6, ease: [0.55, 0.06, 0.68, 0.19] }
            : { delay: 0.15 + i * 0.09, type: 'spring', stiffness: 240, damping: 17 }
        "
      >
        <div class="doc-icon"><DocSheet :color="d.color" :w="44" /></div>
        <div class="doc-name mono">{{ d.name }}</div>
      </Motion>

      <!-- the Box -->
      <Motion
        class="box-card"
        :initial="{ opacity: 0, scale: 0.8, y: 18 }"
        :animate="{ opacity: 1, scale: 1, y: 0 }"
        :transition="{ delay: 0.35, type: 'spring', stiffness: 200, damping: 18 }"
      >
        <Motion
          v-for="n in arrived"
          :key="n"
          class="ripple"
          :initial="{ scale: 0.5, opacity: 0.55 }"
          :animate="{ scale: 2.2, opacity: 0 }"
          :transition="{ duration: 0.75, ease: 'easeOut' }"
        />
        <svg class="box-logo" width="66" height="60" viewBox="0 0 64 58" fill="none">
          <path d="M8 24 L32 13 L56 24 L32 35 Z" fill="#60a5fa" />
          <path d="M8 24 V44 L32 55 V35 Z" fill="#1d4ed8" />
          <path d="M56 24 V44 L32 55 V35 Z" fill="#2563eb" />
          <path d="M8 24 L32 13 L56 24 L32 35 Z" stroke="#93c5fd" stroke-opacity="0.5" />
        </svg>
        <div class="box-title">Box</div>
        <div class="box-sub">customer document library</div>
        <div class="box-counter mono">
          <b>{{ arrived }}</b
          >&nbsp;/ {{ docs.length }} files
        </div>
        <Motion
          v-if="allIn"
          class="box-done"
          :initial="{ opacity: 0, y: 6 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.4 }"
        >
          library ingested
        </Motion>
      </Motion>

      <!-- SQS hand-off chip -->
      <Motion
        v-if="showChip"
        class="sqs-chip"
        :initial="{ opacity: 0, y: 10 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.45 }"
      >
        <span class="sqs-badge">SQS</span>
        <span class="mono">→ ContractScannerQueue</span>
      </Motion>
    </div>

    <Motion
      class="hint"
      :initial="{ opacity: 0 }"
      :animate="showChip ? { opacity: 1 } : { opacity: 0 }"
      :transition="{ duration: 0.6 }"
    >
      → next: the SQS pipeline
    </Motion>
  </div>
</template>

<style scoped>
.stage-root {
  position: relative;
  width: 980px;
  height: 552px;
  overflow: hidden;
}

.deco {
  position: absolute;
  border-radius: 9999px;
  filter: blur(70px);
  pointer-events: none;
}
.deco-amber {
  width: 420px;
  height: 420px;
  left: -140px;
  top: -160px;
  background: rgba(245, 158, 11, 0.1);
}
.deco-blue {
  width: 480px;
  height: 480px;
  right: -160px;
  top: 40px;
  background: rgba(59, 130, 246, 0.14);
}

.header {
  position: absolute;
  top: 22px;
  left: 40px;
  right: 40px;
}
.title {
  font-size: 27px;
  font-weight: 700;
  margin: 0;
}
.accent {
  color: #7cb0f7;
}
.subtitle {
  margin: 6px 0 0;
  font-size: 13.5px;
  color: rgba(226, 232, 240, 0.55);
}

.scene {
  position: absolute;
  left: 20px;
  top: 100px;
  width: 940px;
  height: 400px;
}

.doc {
  position: absolute;
  width: 72px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.doc-icon {
  height: 56px;
  display: flex;
  align-items: flex-end;
}
.doc-name {
  margin-top: 5px;
  font-size: 8.5px;
  line-height: 1.2;
  color: rgba(148, 163, 184, 0.85);
  white-space: nowrap;
  overflow: hidden;
  max-width: 96px;
}

.box-card {
  position: absolute;
  left: 690px;
  top: 28px;
  width: 216px;
  height: 252px;
  border-radius: 24px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: linear-gradient(160deg, rgba(37, 99, 235, 0.16), rgba(2, 6, 23, 0.55));
  box-shadow:
    0 0 60px rgba(59, 130, 246, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 26px;
}
.ripple {
  position: absolute;
  left: 63px;
  top: 22px;
  width: 90px;
  height: 90px;
  border-radius: 9999px;
  border: 2px solid #60a5fa;
  pointer-events: none;
}
.box-logo {
  filter: drop-shadow(0 6px 16px rgba(37, 99, 235, 0.45));
}
.box-title {
  margin-top: 10px;
  font-size: 20px;
  font-weight: 700;
}
.box-sub {
  margin-top: 2px;
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.75);
}
.box-counter {
  margin-top: 14px;
  font-size: 11.5px;
  color: rgba(203, 213, 225, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(2, 6, 23, 0.45);
  border-radius: 999px;
  padding: 4px 12px;
}
.box-counter b {
  color: #fbbf24;
}
.box-done {
  margin-top: 8px;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #34d399;
}

.sqs-chip {
  position: absolute;
  left: 690px;
  top: 296px;
  width: 216px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 10px;
  color: #c4b5fd;
  border: 1px solid rgba(124, 58, 237, 0.45);
  background: rgba(124, 58, 237, 0.12);
  border-radius: 999px;
  padding: 6px 0;
}
.sqs-badge {
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #ede9fe;
  background: #7c3aed;
  border-radius: 5px;
  padding: 2px 6px;
}

.hint {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.45);
}
</style>
