<script lang="ts">
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
</script>

<svelte:head>
    <title>{page.status}</title>
</svelte:head>

<main>
    <h1>{page.status}</h1>
    <p>{page.error?.message ?? 'Something went wrong'}</p>
    <a href={resolve('/')}>Home</a>
</main>

<style>
    main {
        font-family: system-ui, sans-serif;
        padding: 1rem;
    }
</style>
