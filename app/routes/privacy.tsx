import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({
    appName: "RankAI SEO Audit & Optimizer",
    lastUpdated: new Date().toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' })
  });
};

export default function PrivacyPolicy() {
  const { appName, lastUpdated } = useLoaderData<typeof loader>();

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      lineHeight: 1.6,
      color: "#333",
      maxWidth: "800px",
      margin: "0 auto",
      padding: "2rem",
      backgroundColor: "#fff"
    }}>
      <header style={{ marginBottom: "2rem", borderBottom: "1px solid #eaeaea", paddingBottom: "1rem" }}>
        <h1 style={{ fontSize: "2.5rem", margin: "0 0 0.5rem 0", color: "#111" }}>Privacy Policy</h1>
        <p style={{ color: "#666", margin: 0 }}>Last Updated: {lastUpdated}</p>
      </header>

      <main>
        <section style={{ marginBottom: "2rem" }}>
          <p>
            This Privacy Policy describes how your personal information is collected, used, and shared when you install or use the <strong>{appName}</strong> app in connection with your Shopify-supported store.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>Personal Information the App Collects</h2>
          <p>
            When you install the App, we are automatically able to access certain types of information from your Shopify account:
          </p>
          <ul>
            <li><strong>Store Information:</strong> We access data about your store, such as your domain, store name, and email address to set up and manage your account.</li>
            <li><strong>Content Data:</strong> We access your blog posts, articles, and pages (<code>read_content</code>, <code>write_content</code>) to enable shoppable features, SEO analysis, and table of contents generation.</li>
            <li><strong>Product Data:</strong> We access your product catalog (<code>read_products</code>) to allow you to search and embed products within your blog posts.</li>
            <li><strong>Theme Data:</strong> We access your themes (<code>read_themes</code>) to ensure our widgets and app blocks render correctly on your storefront.</li>
          </ul>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>How Do We Use Your Personal Information?</h2>
          <p>We use the personal information we collect from you and your customers in order to provide the Service and to operate the App. Additionally, we use this personal information to:</p>
          <ul>
            <li>Provide you with the core functionality of the App (embedding products, analyzing SEO).</li>
            <li>Communicate with you for customer support or important updates.</li>
            <li>Optimize and improve the App.</li>
            <li>Track analytics and usage of embedded product widgets.</li>
          </ul>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>Sharing Your Personal Information</h2>
          <p>
            We may share your Personal Information to comply with applicable laws and regulations, to respond to a subpoena, search warrant or other lawful request for information we receive, or to otherwise protect our rights.
          </p>
          <p>
            We do not sell, rent, or trade your personal information to third parties.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>Data Retention</h2>
          <p>
            When you install the App, we will maintain your Store Information and App configuration data for our records unless and until you ask us to delete this information. If you uninstall the app, you may request the deletion of your data by contacting us.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>Changes</h2>
          <p>
            We may update this privacy policy from time to time in order to reflect, for example, changes to our practices or for other operational, legal or regulatory reasons.
          </p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", marginTop: 0 }}>Contact Us</h2>
          <p>
            For more information about our privacy practices, if you have questions, or if you would like to make a complaint, please contact us by email at <strong>support@bluepeaks.top</strong>.
          </p>
        </section>
      </main>

      <footer style={{ marginTop: "3rem", borderTop: "1px solid #eaeaea", paddingTop: "1rem", textAlign: "center", color: "#888", fontSize: "0.875rem" }}>
        <p>&copy; {new Date().getFullYear()} {appName}. All rights reserved.</p>
      </footer>
    </div>
  );
}
