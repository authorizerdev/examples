<script>
  import { Authorizer } from '@authorizerdev/authorizer-svelte'
</script>

<div class="login-container">
  <h1>Welcome to Authorizer</h1>
  <br />
  <Authorizer />
</div>

<style>
  .login-container {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
</style>
