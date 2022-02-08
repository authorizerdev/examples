<p align="center">
  <a href="https://www.gatsbyjs.com/?utm_source=starter&utm_medium=readme&utm_campaign=minimal-starter">
    <img alt="Gatsby" src="https://www.gatsbyjs.com/Gatsby-Monogram.svg" width="60" />
  </a>
</p>
<h1 align="center">
  With Gatsby
</h1>

## Quick start

- Get `with-gatsby` example
- Change directory `cd with-gatsby`
- Install dependencies `npm i`
- Start locally `npm start`

# Using Authorizer with Gatsby

# Step 1

Have authorizer instance up and running

# Step 2

Run `npm init gatsby` this will call `create-gatsby` and help you bootstrap gatsby site

Answer the few bootstrapping questions,

- Give your site a name
- Select the repo name
- Select CMS (For demo purpose I did not select any cms)
- Selected `styled-components` for styling system
- Select the additional features you want

# Step 3

Create `src/components/layout.js` as the root layout for app with `AuthorizerProvider`

```jsx
import React from 'react';
import { AuthorizerProvider } from '@authorizerdev/authorizer-react';

// styles
const pageStyles = {
	color: '#232129',
	padding: 96,
	fontFamily: '-apple-system, Roboto, sans-serif, serif',
};

export default function Layout({ children }) {
	return (
		<AuthorizerProvider
			config={{
				authorizerURL: 'https://authorizer-demo.herokuapp.com',
				redirectURL:
					typeof window !== 'undefined' ? window.location.origin : '/',
			}}
		>
			<div
				style={{
					margin: `0 auto`,
					maxWidth: 650,
					padding: `0 1rem`,
					...pageStyles,
				}}
			>
				{children}
			</div>
		</AuthorizerProvider>
	);
}
```

# Step 4

Add root layout in gatsby browser config

Create `gatsby-browser.js` in the root of project with following context

```jsx
const React = require('react');
const Layout = require('./src/components/layout').default;

// Wraps every page in a component
exports.wrapPageElement = ({ element, props }) => {
	return <Layout {...props}>{element}</Layout>;
};
```

This will prevent re-rendering of layout every time the page changes.

# Step 5

Add `Authorizer` component in index page with redirects.

Here incase if user is logged in we would like to redirect them to private route using `useEffect`

Replace content of Index page with following

```jsx
import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';
import * as React from 'react';
import { navigate } from 'gatsby';

const IndexPage = () => {
	const { loading, user } = useAuthorizer();
	React.useEffect(() => {
		if (!loading && user) {
			navigate('/private/dashboard');
		}
	}, [loading, user]);

	if (loading) {
		return <h3>loading...</h3>;
	}

	return (
		<main>
			<Authorizer
				onSignup={() => {
					navigate('/private/dashboard');
				}}
				onLogin={() => {
					navigate('/private/dashboard');
				}}
			/>
		</main>
	);
};

export default IndexPage;
```

# Step 6

Add private routes layout

Add `src/components/private.js` with following content

Here if user is not logged in we would redirect them to home page where we have our Authorizer login component. This also adds logout button which will be common for all private routes

```jsx
import * as React from 'react';
import { useAuthorizer } from '@authorizerdev/authorizer-react';
import { navigate } from 'gatsby';

export default function PrivateLayout({ children }) {
	const { user, loading, authorizerRef, setUser } = useAuthorizer();
	React.useEffect(() => {
		if (!loading && !user) {
			navigate('/');
		}
	}, [loading, user]);

	const handleLogout = async () => {
		await authorizerRef.logout();
		setUser(null);
		navigate('/');
	};

	if (loading) {
		return <h3>loading...</h3>;
	}

	return (
		<div
			style={{
				margin: `0 auto`,
				maxWidth: 650,
				padding: `0 1rem`,
			}}
		>
			<button onClick={handleLogout}>Logout</button>
			{children}
		</div>
	);
}
```

# Step 7

Add private route

Add `src/pages/private/dashboard.js` with following content

```jsx
import * as React from 'react';
import { useAuthorizer } from '@authorizerdev/authorizer-react';
import PrivateLayout from '../../components/private';

export default function Dashboard() {
	const { user } = useAuthorizer();
	return (
		<PrivateLayout>
			<code>{JSON.stringify(user, null, 2)}</code>
		</PrivateLayout>
	);
}
```
