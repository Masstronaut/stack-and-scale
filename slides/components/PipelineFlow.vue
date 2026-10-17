<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Motion } from "motion-v";
import { onSlideEnter, onSlideLeave } from "@slidev/client";
import DocSheet from "./DocSheet.vue";
import QueuePipe from "./QueuePipe.vue";

const stage = ref(0);
const on = (k: number) => stage.value >= k;

const DWELL = [1.4, 3.9, 3.9, 3.9, 4.6];
let loopTimer: ReturnType<typeof setTimeout> | undefined;

function advance() {
  stage.value = (stage.value + 1) % 5;
  loopTimer = setTimeout(advance, DWELL[stage.value] * 1000);
}

function stopLoop() {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = undefined;
}

function startLoop() {
  stopLoop();
  stage.value = 0;
  loopTimer = setTimeout(advance, DWELL[0] * 1000);
}

onMounted(startLoop);
onSlideEnter(startLoop);
onSlideLeave(stopLoop);
onUnmounted(stopLoop);

interface NodeDef {
  name: string;
  queue: string;
  color: string;
  caption: string;
}

const nodes: NodeDef[] = [
  {
    name: "ContractScanner",
    queue: "ContractScannerQueue",
    color: "#f59e0b",
    caption: "contract detected · expiry stamped",
  },
  {
    name: "RelatedDocuments",
    queue: "RelatedDocumentsQueue",
    color: "#34d399",
    caption: "3 of 9 documents are relevant",
  },
  {
    name: "SalesNotes",
    queue: "SalesNotesQueue",
    color: "#38bdf8",
    caption: "verified findings · draft email",
  },
  {
    name: "SalesSlides",
    queue: "SalesSlidesQueue",
    color: "#a78bfa",
    caption: "pitch deck delivered to Box",
  },
];

const xs = [0, 250, 500, 750];
const centers = [95, 345, 595, 845];
const pipeXs = [190, 440, 690];
const CY = 150;

// delays relative to the stage flip that triggers them
const GLOW_DELAY = [0.05, 1.9, 2.3, 2.4]; // node lights up as its payload lands
const CONTENT_DELAY = 0.05;
const CHECK_DELAY = [1.0, 1.35, 1.45, 0.8];
const CAPTION_DELAY = [1.0, 1.1, 1.2, 1.2];
const FLY_DELAY = [0, 1.15, 1.55, 1.65];
const CHIP_DELAY = [0.75, 0.7, 1.1, 0.7];

const STATUS = [
  "Looping: Box → contract → docs → notes → deck",
  "ContractScanner found a contract in Box",
  "RelatedDocuments picked 3 of 9 documents",
  "SalesNotes drafted verified findings",
  "SalesSlides delivered the deck to Box",
];

const ARTIFACTS = [
  { label: "Contract", color: "#f59e0b" },
  { label: "3 relevant docs", color: "#34d399" },
  { label: "Sales notes", color: "#38bdf8" },
  { label: "Pitch deck", color: "#a78bfa" },
];

const relevantSet = [1, 4, 6];
const gridCell = (i: number) => ({
  left: `${24 + (i % 3) * 50}px`,
  top: `${18 + Math.floor(i / 3) * 56}px`,
});

// node-1 viewport geometry
const smallDocs = [
  { x: 12, y: 104, rot: -8, color: "#94a3b8" },
  { x: 118, y: 110, rot: 7, color: "#38bdf8" },
  { x: 50, y: 128, rot: 3, color: "#a78bfa" },
  { x: 128, y: 64, rot: -5, color: "#34d399" },
];
const CONTRACT = { from: { x: 84, y: 96 }, to: { x: 66, y: 24 } };

// node-4 deck fan + sparkles
const deckCards = [
  { dx: -30, dy: 10, rot: -16, delay: 0.1 },
  { dx: -4, dy: 2, rot: -3, delay: 0.25 },
  { dx: 30, dy: 16, rot: 10, delay: 0.4 },
];
const sparkles = [
  { dx: 36, dy: -28, c: "#fbbf24", s: 7 },
  { dx: -32, dy: -32, c: "#34d399", s: 6 },
  { dx: 44, dy: 6, c: "#38bdf8", s: 6 },
  { dx: -46, dy: 0, c: "#f472b6", s: 7 },
  { dx: 22, dy: -44, c: "#a78bfa", s: 5 },
  { dx: -20, dy: -48, c: "#fbbf24", s: 5 },
];
const noteLines = [
  { w: 92, c: "#cbd5e1" },
  { w: 86, c: "#cbd5e1" },
  { w: 62, c: "#cbd5e1" },
  { w: 90, c: "#cbd5e1" },
  { w: 46, c: "#fbbf24" },
];

function spring(delay: number, stiffness = 220, damping = 16) {
  return { delay, type: "spring", stiffness, damping };
}
function fade(delay: number, duration = 0.4) {
  return { delay, duration };
}
function flightTransition(s: number) {
  return {
    delay: FLY_DELAY[s],
    duration: 0.85,
    ease: "easeInOut" as const,
  };
}
function flightX(s: number, t: number) {
  const a = centers[s - 1];
  const b = centers[s];
  return a + (b - a) * t;
}
</script>

<template>
  <div class="stage-root">
    <div class="deco deco-violet" />
    <div class="deco deco-green" />

    <div class="header">
      <Motion
        :initial="{ opacity: 0, y: -10 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
      >
        <h1 class="title">One contract, four <span class="accent">SQS</span> workers</h1>
        <p class="subtitle">
          Every hop is its own queue — isolated retries, DLQ after 3 failed attempts.
        </p>
      </Motion>
    </div>

    <div class="status-row">
      <Motion
        :initial="{ opacity: 0, y: -8 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ delay: 0.15, duration: 0.45 }"
        class="status"
      >
        <span
          class="dot"
          :class="{ pulse: stage >= 1 && stage <= 3 }"
          :style="{
            background: stage === 0 ? '#64748b' : stage === 4 ? '#34d399' : nodes[stage - 1].color,
          }"
        />
        <Motion
          :key="stage"
          :initial="{ opacity: 0, y: 6 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.25 }"
        >
          <span class="status-text">{{ STATUS[stage] }}</span>
        </Motion>
        <span class="step mono">{{ stage === 0 ? 'auto' : stage + '/4' }}</span>
      </Motion>
    </div>

    <div class="canvas">
      <!-- pipes -->
      <QueuePipe
        v-for="(px, c) in pipeXs"
        :key="px"
        :x="px"
        :active="stage >= c + 1"
        :color="nodes[c + 1].color"
      />

      <!-- nodes -->
      <template v-for="(n, k) in nodes" :key="n.name">
        <Motion
          class="glow-soft"
          :style="{
            left: `${xs[k] - 10}px`,
            background: `radial-gradient(closest-side, ${n.color}30, transparent)`,
          }"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: on(k + 1) ? 1 : 0 }"
          :transition="{ delay: on(k + 1) ? GLOW_DELAY[k] : 0, duration: 0.5 }"
        />
        <div class="node" :style="{ left: `${xs[k]}px` }">
          <div class="node-head">
            <div
              class="node-icon"
              :style="{ borderColor: `${n.color}55`, background: `${n.color}1c`, color: n.color }"
            >
              <!-- magnifier -->
              <svg v-if="k === 0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.8" />
                <path
                  d="M9.2 9.2 L12.4 12.4"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
              <!-- link -->
              <svg v-else-if="k === 1" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M5.5 8.5 L8.5 5.5"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
                <path
                  d="M6.2 3.6 L7.6 2.2 A2.5 2.5 0 0 1 11.1 5.7 L9.7 7.1"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
                <path
                  d="M7.8 10.4 L6.4 11.8 A2.5 2.5 0 0 1 2.9 8.3 L4.3 6.9"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
              <!-- pen -->
              <svg v-else-if="k === 2" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect
                  x="2"
                  y="2.5"
                  width="8.5"
                  height="9.5"
                  rx="1.5"
                  stroke="currentColor"
                  stroke-width="1.6"
                />
                <path
                  d="M4.5 5.5 H8 M4.5 7.5 H8 M4.5 9.5 H6.5"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
              <!-- deck -->
              <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect
                  x="1.5"
                  y="2"
                  width="11"
                  height="7.5"
                  rx="1.2"
                  stroke="currentColor"
                  stroke-width="1.6"
                />
                <path
                  d="M5 12 H9"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
                <path d="M6 4.4 L8.6 5.75 L6 7.1 Z" fill="currentColor" />
              </svg>
            </div>
            <div class="node-names">
              <div class="node-name">{{ n.name }}</div>
              <div class="node-queue mono">{{ n.queue }}</div>
            </div>
          </div>

          <Motion
            class="check"
            :initial="{ scale: 0, opacity: 0 }"
            :animate="on(k + 1) ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }"
            :transition="spring(on(k + 1) ? CHECK_DELAY[k] : 0, 320, 14)"
          >
            <svg width="9" height="9" viewBox="0 0 10 10">
              <path
                d="M1.5 5.2 L4 7.6 L8.5 2.6"
                stroke="#052e1b"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </svg>
          </Motion>

          <div class="viewport">
            <Motion
              class="vp-content"
              :initial="{ opacity: 0.16 }"
              :animate="{ opacity: on(k + 1) ? 1 : 0.16 }"
              :transition="{ delay: on(k + 1) ? CONTENT_DELAY : 0, duration: 0.4 }"
            >
              <!-- ============ node 1: contract scanner ============ -->
              <template v-if="k === 0">
                <div
                  v-for="(sd, i) in smallDocs"
                  :key="'sd' + i"
                  class="abs"
                  :style="{
                    left: `${sd.x}px`,
                    top: `${sd.y}px`,
                    transform: `rotate(${sd.rot}deg)`,
                  }"
                >
                  <DocSheet :color="sd.color" :w="30" />
                </div>
                <Motion
                  class="abs glowspot"
                  :style="{ left: '36px', top: '4px' }"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: on(1) ? 0.85 : 0 }"
                  :transition="{ delay: on(1) ? 0.45 : 0, duration: 0.45 }"
                />
                <Motion
                  class="abs"
                  :style="{ left: `${CONTRACT.from.x}px`, top: `${CONTRACT.from.y}px` }"
                  :initial="{ x: 0, y: 0, scale: 1, rotate: -4 }"
                  :animate="
                    on(1)
                      ? {
                          x: CONTRACT.to.x - CONTRACT.from.x,
                          y: CONTRACT.to.y - CONTRACT.from.y,
                          scale: 1.3,
                          rotate: 0,
                        }
                      : { x: 0, y: 0, scale: 1, rotate: -4 }
                  "
                  :transition="spring(on(1) ? 0.45 : 0, 200, 15)"
                >
                  <DocSheet color="#f59e0b" :w="38" />
                </Motion>
                <Motion
                  class="stamp"
                  :style="{ left: '50px', top: '16px' }"
                  :initial="{ opacity: 0, scale: 2.4, rotate: -2 }"
                  :animate="
                    on(1)
                      ? { opacity: 1, scale: 1, rotate: -10 }
                      : { opacity: 0, scale: 2.4, rotate: -2 }
                  "
                  :transition="spring(on(1) ? 0.7 : 0, 300, 13)"
                >
                  CONTRACT
                </Motion>
                <Motion
                  class="mini-tag mono"
                  :style="{ left: '36px', top: '118px' }"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: on(1) ? 1 : 0 }"
                  :transition="fade(on(1) ? 1.0 : 0)"
                >
                  expiry → metadata ✓
                </Motion>
              </template>

              <!-- ============ node 2: related documents ============ -->
              <template v-else-if="k === 1">
                <Motion
                  v-for="i in 9"
                  :key="'cell' + i"
                  class="cell"
                  :style="gridCell(i - 1)"
                  :initial="{ opacity: 0.85, scale: 1 }"
                  :animate="
                    on(2)
                      ? relevantSet.includes(i - 1)
                        ? { opacity: 1, scale: 1.14, y: -3 }
                        : { opacity: 0.14, scale: 0.92 }
                      : { opacity: 0.85, scale: 1 }
                  "
                  :transition="
                    on(2) && relevantSet.includes(i - 1)
                      ? spring(0.55, 260, 15)
                      : fade(on(2) ? 0.55 : 0, 0.35)
                  "
                >
                  <div class="cell-ring" :class="{ lit: on(2) && relevantSet.includes(i - 1) }" />
                  <DocSheet
                    :color="relevantSet.includes(i - 1) && on(2) ? '#34d399' : '#7c8db0'"
                    :w="26"
                  />
                  <Motion
                    class="cell-check"
                    :initial="{ scale: 0 }"
                    :animate="{ scale: on(2) && relevantSet.includes(i - 1) ? 1 : 0 }"
                    :transition="spring(on(2) ? 0.75 : 0, 340, 13)"
                  >
                    <svg width="7" height="7" viewBox="0 0 10 10">
                      <path
                        d="M1.5 5.2 L4 7.6 L8.5 2.6"
                        stroke="#052e1b"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        fill="none"
                      />
                    </svg>
                  </Motion>
                </Motion>
                <Motion
                  class="counter mono"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: on(2) ? 1 : 0 }"
                  :transition="fade(on(2) ? 1.0 : 0)"
                >
                  3 / 9
                </Motion>
              </template>

              <!-- ============ node 3: sales notes ============ -->
              <template v-else-if="k === 2">
                <Motion
                  class="sheet"
                  :initial="{ opacity: 0.3, scale: 0.85, rotate: 2 }"
                  :animate="
                    on(3)
                      ? { opacity: 1, scale: 1, rotate: -1.5 }
                      : { opacity: 0.3, scale: 0.85, rotate: 2 }
                  "
                  :transition="spring(on(3) ? 0.1 : 0, 220, 17)"
                >
                  <Motion
                    v-for="(ln, li) in noteLines"
                    :key="'ln' + li"
                    class="note-line"
                    :style="{
                      width: `${ln.w}px`,
                      background: ln.c,
                      marginTop: li === 0 ? 0 : '12px',
                    }"
                    :initial="{ scaleX: 0 }"
                    :animate="{ scaleX: on(3) ? 1 : 0 }"
                    :transition="{
                      delay: on(3) ? 0.3 + li * 0.16 : 0,
                      duration: 0.35,
                      ease: 'easeOut',
                    }"
                  />
                </Motion>
                <Motion
                  class="mini-tag mono"
                  :style="{ left: '32px', top: '156px' }"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: on(3) ? 1 : 0 }"
                  :transition="fade(on(3) ? 1.3 : 0)"
                >
                  grounded in cited passages
                </Motion>
              </template>

              <!-- ============ node 4: sales slides ============ -->
              <template v-else>
                <div class="deck-anchor">
                  <Motion
                    v-for="(card, ci) in deckCards"
                    :key="'deck' + ci"
                    class="deck-card"
                    :class="`deck-card-${ci}`"
                    :initial="{ x: 0, y: 0, rotate: 0, opacity: 0.75 }"
                    :animate="
                      on(4)
                        ? { x: card.dx, y: card.dy, rotate: card.rot, opacity: 1 }
                        : { x: 0, y: 0, rotate: 0, opacity: 0.75 }
                    "
                    :transition="spring(on(4) ? card.delay : 0, 180, 14)"
                  >
                    <template v-if="ci === 2">
                      <div class="deck-bar" />
                      <div class="deck-bars">
                        <Motion
                          v-for="(bh, bi) in [9, 15, 21]"
                          :key="'bar' + bi"
                          class="deck-col"
                          :style="{
                            height: `${bh}px`,
                            background: ['#34d399', '#fbbf24', '#38bdf8'][bi],
                          }"
                          :initial="{ scaleY: 0.15 }"
                          :animate="{ scaleY: on(4) ? 1 : 0.15 }"
                          :transition="{
                            delay: on(4) ? 0.7 + bi * 0.09 : 0,
                            duration: 0.35,
                            ease: 'easeOut',
                          }"
                        />
                      </div>
                    </template>
                    <div v-else class="deck-lines">
                      <div class="deck-line" />
                      <div class="deck-line short" />
                    </div>
                  </Motion>
                  <Motion
                    v-for="(sp, si) in sparkles"
                    :key="'sp' + si"
                    class="spark"
                    :style="{ background: sp.c, width: `${sp.s}px`, height: `${sp.s}px` }"
                    :initial="{ opacity: 0, scale: 0, x: 0, y: 0 }"
                    :animate="
                      on(4)
                        ? { opacity: [0, 1, 0], scale: [0, 1, 0.2], x: [0, sp.dx], y: [0, sp.dy] }
                        : { opacity: 0 }
                    "
                    :transition="{
                      delay: on(4) ? 0.55 + si * 0.06 : 0,
                      duration: 0.75,
                      ease: 'easeOut',
                    }"
                  />
                </div>
                <Motion
                  class="deliver-chip mono"
                  :initial="{ opacity: 0, y: 6 }"
                  :animate="on(4) ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }"
                  :transition="fade(on(4) ? 1.0 : 0)"
                >
                  → Box · SalesDeck.pdf
                </Motion>
              </template>
            </Motion>
          </div>

          <Motion
            class="caption"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: on(k + 1) ? 1 : 0 }"
            :transition="fade(on(k + 1) ? CAPTION_DELAY[k] : 0)"
            :style="{ color: n.color }"
          >
            {{ n.caption }}
          </Motion>

          <Motion
            class="node-ring"
            :style="{ borderColor: n.color }"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: on(k + 1) ? 0.9 : 0 }"
            :transition="{ delay: on(k + 1) ? GLOW_DELAY[k] : 0, duration: 0.45 }"
          />
        </div>
      </template>

      <!-- payload flying between nodes -->
      <Motion
        v-if="stage >= 1 && stage <= 3"
        :key="`flight-${stage}`"
        class="payload"
        :initial="{ x: centers[stage - 1], y: CY, scale: 0.9, opacity: 0 }"
        :animate="{
          x: [centers[stage - 1], flightX(stage, 0.3), flightX(stage, 0.72), centers[stage]],
          y: [CY, CY, CY - 44, CY],
          scale: [0.9, 1.14, 1.05, 0.4],
          opacity: [0, 1, 1, 0],
        }"
        :transition="flightTransition(stage)"
      >
        <template v-if="stage === 1">
          <DocSheet color="#f59e0b" :w="40" />
        </template>
        <div v-else-if="stage === 2" class="bundle">
          <div class="bundled" style="left: 0; top: 12px; transform: rotate(-14deg)">
            <DocSheet color="#34d399" :w="24" />
          </div>
          <div class="bundled" style="left: 22px; top: 6px; transform: rotate(10deg)">
            <DocSheet color="#34d399" :w="24" />
          </div>
          <div class="bundled" style="left: 11px; top: 20px; transform: rotate(-2deg)">
            <DocSheet color="#34d399" :w="24" />
          </div>
          <div class="bundled" style="left: 12px; top: 0"><DocSheet color="#f59e0b" :w="34" /></div>
        </div>
        <div v-else class="bundle">
          <div class="bundled" style="left: 0; top: 8px; transform: rotate(-10deg)">
            <DocSheet color="#f59e0b" :w="32" />
          </div>
          <div class="bundled" style="left: 20px; top: 2px; transform: rotate(8deg)">
            <DocSheet color="#38bdf8" :w="32" />
          </div>
        </div>
      </Motion>
    </div>

    <!-- artifacts accumulated so far -->
    <div class="artifacts">
      <Motion
        v-for="(a, ai) in ARTIFACTS"
        :key="a.label"
        class="artifact"
        :initial="{ opacity: 0.28 }"
        :animate="on(ai + 1) ? { opacity: 1 } : { opacity: 0.28 }"
        :transition="on(ai + 1) ? spring(CHIP_DELAY[ai], 260, 16) : fade(0)"
        :style="
          on(ai + 1)
            ? { borderColor: `${a.color}66`, background: `${a.color}14`, color: '#e2e8f0' }
            : {}
        "
      >
        <span class="artifact-dot" :style="{ background: on(ai + 1) ? a.color : '#475569' }" />
        {{ a.label }}
      </Motion>
    </div>

    <div class="watermark mono">stack-and-scale · SST · SQS · Lambda · Box</div>
    <div class="hint">auto-playing · loops until you leave the slide</div>
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
.deco-violet {
  width: 460px;
  height: 460px;
  left: -150px;
  top: -170px;
  background: rgba(139, 92, 246, 0.12);
}
.deco-green {
  width: 440px;
  height: 440px;
  right: -150px;
  bottom: -160px;
  background: rgba(16, 185, 129, 0.09);
}

.header {
  position: absolute;
  top: 16px;
  left: 40px;
  right: 40px;
  text-align: center;
}
.title {
  font-size: 23px;
  font-weight: 700;
  margin: 0;
}
.accent {
  color: #c4b5fd;
}
.subtitle {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: rgba(226, 232, 240, 0.5);
}

.status-row {
  position: absolute;
  top: 78px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
}
.status {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.6);
  border-radius: 999px;
  padding: 6px 16px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.dot.pulse {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.25);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0);
  }
}
.status-text {
  font-size: 11.5px;
  color: #cbd5e1;
}
.step {
  font-size: 9.5px;
  color: rgba(148, 163, 184, 0.6);
}

.canvas {
  position: absolute;
  left: 20px;
  top: 122px;
  width: 940px;
  height: 300px;
}

.node {
  position: absolute;
  top: 4px;
  width: 190px;
  height: 292px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(148, 163, 184, 0.06);
  padding: 10px;
}
.node-ring {
  position: absolute;
  inset: -1px;
  border-radius: 17px;
  border-width: 1.5px;
  border-style: solid;
  pointer-events: none;
}
.glow-soft {
  position: absolute;
  top: -6px;
  width: 210px;
  height: 312px;
  filter: blur(16px);
  pointer-events: none;
}

.node-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 8px;
}
.node-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.node-names {
  min-width: 0;
}
.node-name {
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.node-queue {
  font-size: 8px;
  color: rgba(148, 163, 184, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.check {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #34d399;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  box-shadow: 0 0 14px rgba(52, 211, 153, 0.5);
}

.viewport {
  position: relative;
  height: 202px;
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.09);
  overflow: hidden;
}
.vp-content {
  position: absolute;
  inset: 0;
}
.abs {
  position: absolute;
}

.glowspot {
  width: 84px;
  height: 84px;
  border-radius: 999px;
  background: radial-gradient(closest-side, rgba(245, 158, 11, 0.5), transparent);
  filter: blur(10px);
}
.stamp {
  position: absolute;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: #fbbf24;
  border: 2px solid #fbbf24;
  border-radius: 5px;
  background: rgba(245, 158, 11, 0.12);
  padding: 2px 7px;
  text-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
}
.mini-tag {
  position: absolute;
  font-size: 8px;
  color: rgba(148, 163, 184, 0.75);
  white-space: nowrap;
}

.cell {
  position: absolute;
  width: 40px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cell-ring {
  position: absolute;
  inset: -2px;
  border-radius: 7px;
  border: 1.5px solid #34d399;
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.35);
  opacity: 0;
  transition: opacity 0.3s;
}
.cell-ring.lit {
  opacity: 1;
}
.cell-check {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #34d399;
  display: flex;
  align-items: center;
  justify-content: center;
}
.counter {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 9px;
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
  border-radius: 999px;
  padding: 2px 8px;
}

.sheet {
  position: absolute;
  left: 34px;
  top: 20px;
  width: 122px;
  height: 126px;
  border-radius: 10px;
  background: #f1f5f9;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
  padding: 18px 14px;
}
.note-line {
  height: 4.5px;
  border-radius: 3px;
  transform-origin: left center;
}

.deck-anchor {
  position: absolute;
  left: 58px;
  top: 52px;
  width: 74px;
  height: 50px;
}
.deck-card {
  position: absolute;
  inset: 0;
  border-radius: 6px;
  background: #101a30;
  border: 1px solid rgba(148, 163, 184, 0.28);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  padding: 7px 8px;
}
.deck-bar {
  width: 42px;
  height: 5px;
  border-radius: 3px;
  background: rgba(147, 197, 253, 0.85);
}
.deck-bars {
  position: absolute;
  left: 8px;
  bottom: 7px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.deck-col {
  width: 8px;
  border-radius: 2px;
  transform-origin: bottom center;
}
.deck-lines {
  padding-top: 3px;
}
.deck-line {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.4);
  margin-bottom: 6px;
}
.deck-line.short {
  width: 26px;
}
.spark {
  position: absolute;
  left: 33px;
  top: 21px;
  border-radius: 999px;
  pointer-events: none;
}
.deliver-chip {
  position: absolute;
  left: 22px;
  top: 138px;
  font-size: 8.5px;
  color: #6ee7b7;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.08);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
}

.caption {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8.5px;
  letter-spacing: 0.02em;
}

.payload {
  position: absolute;
  left: -27px;
  top: -33px;
  z-index: 40;
  pointer-events: none;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
}
.bundle {
  position: relative;
  width: 54px;
  height: 62px;
}
.bundled {
  position: absolute;
}

.artifacts {
  position: absolute;
  top: 446px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 10px;
}
.artifact {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: rgba(203, 213, 225, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(148, 163, 184, 0.05);
  border-radius: 999px;
  padding: 5px 14px;
}
.artifact-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.watermark {
  position: absolute;
  left: 24px;
  bottom: 14px;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.3);
}
.hint {
  position: absolute;
  right: 24px;
  bottom: 14px;
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.4);
}
</style>
