<!--
  @component 
  
  Button to send the user to the login page
-->
<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import LoginIcon from '$lib/components/site/icons/LoginIcon.svelte';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    function onclick(): void {
        void goto(`/login?returnPath=${encodeURIComponent(page.url.pathname + page.url.search)}`);
    }
</script>

<ControlStripButton {onclick}><LoginIcon height=".9em" width=".9em" />Login</ControlStripButton>
