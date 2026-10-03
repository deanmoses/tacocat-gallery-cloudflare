<!--
  @component 
  
  An icon representing the concept of "reorder"
-->
<script lang="ts">
    import Icon from './Icon.svelte';

    interface Props {
        width?: string | undefined;
        height?: string | undefined;
        title?: string | undefined;
    }

    let { width = '0.89em', height, title }: Props = $props();

    const d = 'M4 6v9H1.5L6 20l4.5-5H8V6zm10-6L9.5 5H12v9h4V5h2.5z';
    const viewBox = '0.2 -2 19.6 22';
</script>

<!-- The arrows fill their grid's full height, so they sit lower than the shared lift puts them to line up with the other icons, and are narrow, so the box is too. -->
<Icon bottom="0.06em" {d} {height} {title} {viewBox} {width} />
