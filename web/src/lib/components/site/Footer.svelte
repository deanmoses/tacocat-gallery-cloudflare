<!--
  @component

  Site's footer
-->
<script lang="ts">
    import logoWebp from '$lib/assets/tacocat-logo.webp';
    import logoPng from '$lib/assets/tacocat-logo.png';
</script>

<footer class="hidden-sm">
    <picture>
        <source srcset={logoWebp} type="image/webp" />
        <source srcset={logoPng} type="image/png" />
        <img alt="" decoding="async" draggable="false" height="19" src={logoPng} width="102" />
    </picture>
</footer>

<style>
    footer {
        padding-top: calc(var(--default-padding) * 2);
    }
</style>
