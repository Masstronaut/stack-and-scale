<script setup lang="ts">
defineProps<{ x: number; active: boolean; color: string }>();
</script>

<template>
  <div class="pipe" :style="{ left: `${x}px` }">
    <div class="chip">SQS</div>
    <svg width="60" height="12" viewBox="0 0 60 12">
      <line x1="4" y1="6" x2="52" y2="6" class="track" />
      <line
        x1="4"
        y1="6"
        x2="52"
        y2="6"
        class="flow"
        :class="{ live: active }"
        :stroke="active ? color : '#475569'"
      />
    </svg>
    <div
      class="arrow"
      :class="{ live: active }"
      :style="active ? { borderLeftColor: color } : {}"
    />
  </div>
</template>

<style scoped>
.pipe {
  position: absolute;
  top: 144px;
  width: 60px;
  height: 12px;
}
.track {
  stroke: rgba(148, 163, 184, 0.22);
  stroke-width: 6;
  stroke-linecap: round;
}
.flow {
  stroke-width: 6;
  stroke-linecap: round;
  stroke-dasharray: 7 9;
  opacity: 0.25;
}
.flow.live {
  opacity: 1;
  animation: dash-flow 0.6s linear infinite;
}
@keyframes dash-flow {
  to {
    stroke-dashoffset: -32;
  }
}
.chip {
  position: absolute;
  top: -32px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #ddd6fe;
  border: 1px solid rgba(124, 58, 237, 0.55);
  background: rgba(124, 58, 237, 0.18);
  border-radius: 6px;
  padding: 2px 7px;
  white-space: nowrap;
}
.arrow {
  position: absolute;
  right: -6px;
  top: 1px;
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 9px solid #475569;
  opacity: 0.4;
  transition: opacity 0.3s;
}
.arrow.live {
  opacity: 1;
}
</style>
