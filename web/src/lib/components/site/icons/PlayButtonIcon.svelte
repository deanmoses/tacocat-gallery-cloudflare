<!--
  @component

  A play button with a semi-transparent circular backdrop (YouTube-style)
-->
<script lang="ts">
    import PlayIcon from './PlayIcon.svelte';

    interface Props {
        size?: string | undefined;
    }

    let { size = '3em' }: Props = $props();
</script>

<div style:width={size} style:height={size} class="play-button">
    <PlayIcon bottom="0" height="50%" width="50%" />
</div>

<style>
    .play-button {
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgb(0 0 0 / 40%);
        color: #ffffff;
    }
</style>
