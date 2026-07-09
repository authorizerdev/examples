<template>
  <authorizer-provider
    :config="{
      authorizerURL: 'http://localhost:8080',
      redirectURL: origin,
      clientID: 'kbyuFDidLLm280LIwVFiazOqjO3ty8KH',
    }"
  >
    <main style="max-width: 480px; margin: 2rem auto; font-family: sans-serif">
      <h1>Authorizer Vue Demo</h1>
      <router-view />
    </main>
  </authorizer-provider>
</template>

<script>
import { AuthorizerProvider } from '@authorizerdev/authorizer-vue';

export default {
  components: { 'authorizer-provider': AuthorizerProvider },
  setup() {
    return { origin: window.location.origin };
  },
};
</script>
