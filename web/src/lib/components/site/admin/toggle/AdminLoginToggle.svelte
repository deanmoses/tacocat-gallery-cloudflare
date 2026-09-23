<!--
  @component
  
  On hover, display button to login in
-->
<script lang="ts">
    import LoginButton from './toggle_buttons/LoginButton.svelte';
</script>

<div>
    <nav>
        <LoginButton />
    </nav>
</div>

<style>
    div {
        position: fixed;
        top: 0;
        left: 0;
        min-height: 4em;
        min-width: 8em;
    }

    nav {
        width: 100%;
        padding: 0.5em;
        border-bottom: 1px solid #000000;
        border-bottom-right-radius: 8px;
        background-color: rgb(65 64 64);
        color: rgb(211 211 211);
        display: none; /* will be overridden on hover */
    }

    div:hover nav {
        display: flex;
        align-items: center;
        gap: 1em;
        animation: fade-in 1400ms;
    }

    @keyframes fade-in {
        0% {
            opacity: 0;
        }

        100% {
            opacity: 1;
        }
    }
</style>
