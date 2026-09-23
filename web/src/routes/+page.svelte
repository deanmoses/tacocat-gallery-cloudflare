<script lang="ts">
    let count = $state(0);

    function increment(): void {
        count += 1;
    }
</script>

<svelte:head>
    <title>Tacocat Gallery</title>
</svelte:head>

<main>
    <h1>Hello, world</h1>
    <button onclick={increment} type="button">Clicked {count} {count === 1 ? 'time' : 'times'}</button>
</main>

<style>
    main {
        font-family: system-ui, sans-serif;
    }
</style>
