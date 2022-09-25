<script>
  import { getContext } from 'svelte'
  let state

  const store = getContext('authorizerContext')

  store.subscribe(data => {
    state = data
  })

  const logoutHandler = async () => {
    await state.logout()
  }
</script>

<div>
  <h1>Hey 👋,</h1>
  <p>Thank you for joining Authorizer demo app.</p>
  <p>
    Your email address is
    <a href={`mailto:${state.user?.email}`} style="color: #3B82F6;">
      {state.user?.email}
    </a>
  </p>
  <br />
  {#if state.loading}
    <h3>Processing....</h3>
  {:else}
    <h3 style="color: #3B82F6; cursor: pointer;" on:click={logoutHandler}>
      Logout
    </h3>
  {/if}
</div>
