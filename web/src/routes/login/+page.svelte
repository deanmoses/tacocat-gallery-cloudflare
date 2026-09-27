<script lang="ts">
    import { page } from '$app/state';
    import LoginPage from '$lib/components/pages/auth/LoginPage.svelte';
    import { sameSitePath } from '$lib/utils/returnPath';
</script>

<LoginPage returnPath={sameSitePath(page.url.searchParams.get('returnPath'), page.url.origin)} />
