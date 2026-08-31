
import Link from 'next/link';

const HomePage = () => {
  return (
    <main className="p-4 md:max-w-2xl">
      <section className="h-screen w-full flex flex-col items-center justify-center">
        <header>
          <h1 className="text-4xl font-medium tracking-tight mb-4">
            Authorizer Homepage!!!
          </h1>
        </header>
        <p className="text-lg text-gray-200">
          Authorizer is a simple, secure, and scalable authentication and
          authorization service that allows you to add authentication to your
          applications and APIs in just a few minutes.
        </p>
        <Link href="/authenticate" className="w-full">
          {/* <Button className="mt-16">Get Started today</Button> */}
        </Link>
      </section>

    </main>
  );
};

export default HomePage;