<script>
  import { getContext } from 'svelte'
  import { Router, Route } from 'svelte-routing'
  import Dashboard from './routes/Dashboard.svelte'
  import Login from './routes/Login.svelte'
  import ResetPassword from './routes/ResetPassword.svelte'

  let state

  const store = getContext('authorizerContext')

  store.subscribe(data => {
    state = data
  })
</script>

<Router>
  {#if state.loading}
    <h1>Loading...</h1>
  {:else if state.token}
    <Route path="/">
      <Dashboard />
    </Route>
  {:else}
    <Route path="reset-password">
      <ResetPassword />
    </Route>
    <Route path="/">
      <Login />
    </Route>
  {/if}
</Router>
