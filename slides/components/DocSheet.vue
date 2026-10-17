<script setup lang="ts">
withDefaults(defineProps<{ color?: string; w?: number }>(), {
  color: "#94a3b8",
  w: 44,
});
</script>

<template>
  <svg :width="w" :height="(w * 55) / 44" viewBox="0 0 44 55" fill="none" style="display: block">
    <path
      d="M8 2 H27 L40 15 V49 Q40 53 36 53 H8 Q4 53 4 49 V6 Q4 2 8 2 Z"
      :fill="color"
      opacity="0.16"
    />
    <path
      d="M8 2 H27 L40 15 V49 Q40 53 36 53 H8 Q4 53 4 49 V6 Q4 2 8 2 Z"
      :stroke="color"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
    <path
      d="M27 2 V10 Q27 15 32 15 H40 Z"
      :fill="color"
      fill-opacity="0.35"
      :stroke="color"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
    <rect x="11" y="24" width="22" height="2.6" rx="1.3" :fill="color" opacity="0.75" />
    <rect x="11" y="31" width="22" height="2.6" rx="1.3" :fill="color" opacity="0.45" />
    <rect x="11" y="38" width="13" height="2.6" rx="1.3" :fill="color" opacity="0.45" />
  </svg>
</template>
