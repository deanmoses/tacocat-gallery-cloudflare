<!--
  @component

  A play button icon (triangle pointing right)
-->
<script lang="ts">
    import Icon from './Icon.svelte';

    interface Props {
        width?: string | undefined;
        height?: string | undefined;
        title?: string | undefined;
        bottom?: string | undefined;
    }

    let { width = '1em', height = '1em', title, bottom }: Props = $props();

    // Play triangle: equilateral proportions, optically centered (shifted right ~6 units)
    // Left corners use quadratic bezier curves for rounding, right point stays sharp
    const d = 'M17 8 Q17 0 25 4 L97 50 L25 96 Q17 100 17 92 Z';
    const viewBox = '0 0 100 100';
</script>

<Icon {bottom} {d} {height} {title} {viewBox} {width} />
