<script lang="ts">
    import { page } from '$app/state';
    import InvitePage from '$lib/components/pages/auth/InvitePage.svelte';
</script>

<InvitePage token={page.params.token ?? ''} />
