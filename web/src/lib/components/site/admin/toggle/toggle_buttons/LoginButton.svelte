<!--
  @component 
  
  Button to send the user to the login page
-->
<script lang="ts">
    import LoginIcon from '$lib/components/site/icons/LoginIcon.svelte';
    import ControlStripButton from '../../edit_controls/buttons/ControlStripButton.svelte';

    // The login page is the Worker's, outside the app, so this is a whole-document navigation.
    function onclick(): void {
        location.assign('/login');
    }
</script>

<ControlStripButton {onclick}><LoginIcon width=".9em" height=".9em" />Login</ControlStripButton>
