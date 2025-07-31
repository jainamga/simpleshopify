import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Supercharge Your Store's SEO</h1>
        <p className={styles.text}>
          Bulk-edit product meta titles, descriptions, and image alt text in
          minutes, not hours. Boost your search rankings with powerful AI-driven
          tools.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-shop-name.myshopify.com"
              />
            </label>
            <button className={styles.button} type="submit">
              Install & Log In
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Bulk Metadata Editor</strong>. Quickly edit meta titles and
            descriptions for hundreds of products on a single page. Stay within
            SEO best practices with built-in character counters.
          </li>
          <li>
            <strong>AI-Powered Alt Text Generation</strong>. Instantly generate
            SEO-optimized alt text for your product images using AI. Improve
            accessibility and capture more traffic from image searches.
          </li>
          <li>
            <strong>Efficient Workflow</strong>. Manage all your critical
            on-page SEO from one intuitive interface. See product images, edit
            text, and save changes without ever leaving the page.
          </li>
        </ul>
      </div>
    </div>
  );
}