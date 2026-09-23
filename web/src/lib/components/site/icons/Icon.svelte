<!--
  @component 
  
  Base component for all SVG icons
-->
<script lang="ts">
    interface Props {
        /** Width of the icon (default: '1em') */
        width?: string | undefined;
        /** Height of the icon (default: '1em') */
        height?: string | undefined;
        /** Accessible title for screen readers */
        title?: string | undefined;
        /** SVG path data */
        d: string;
        /** SVG viewBox attribute */
        viewBox: string;
        /**
         * Bottom offset for text baseline alignment.  Use the default '0.125em'
         * to display inline with text, use '0' for when displaying standalone.
         */
        bottom?: string | undefined;
    }

    let { width = '1em', height = '1em', title, d, viewBox, bottom = '0.125em' }: Props = $props();
</script>

<svg style:bottom aria-hidden={title ? undefined : true} {height} {viewBox} {width}>
    {#if title}<title>{title}</title>{/if}
    <path {d} />
</svg>

<style>
    svg {
        display: inline;
        position: relative;
        vertical-align: middle;
    }

    path {
        fill: currentColor;
    }
</style>
