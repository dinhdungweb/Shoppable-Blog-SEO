import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, IndexTable, TextField } from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

interface ArticleData {
  id: string;
  title: string;
  author: string;
  handle: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return redirect("/app/blogs");

  const idArray = idsParam.split(',').map(id => `gid://shopify/Article/${id}`);
  
  const response = await admin.graphql(
    `#graphql
    query GetArticles($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Article {
          id
          title
          author { name }
          handle
        }
      }
    }`,
    { variables: { ids: idArray } }
  );

  const parsed = await response.json();
  
  const articles: ArticleData[] = (parsed.data?.nodes || [])
    .filter(Boolean)
    .map((node: any) => ({
      id: node.id,
      title: node.title || "",
      author: node.author?.name || "",
      handle: node.handle || ""
    }));

  return json({ articles });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const payloadStr = formData.get("payload") as string;
  
  if (!payloadStr) return json({ error: "Missing payload" }, { status: 400 });
  const items: ArticleData[] = JSON.parse(payloadStr);

  for (const item of items) {
    await admin.graphql(
      `#graphql
      mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
        articleUpdate(id: $id, article: $article) {
          article { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: item.id,
          article: {
            title: item.title,
            author: item.author,
            handle: item.handle
          }
        }
      }
    );
  }

  return redirect("/app/blogs");
};

export default function BulkEditArticles() {
  const { articles } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();

  const [items, setItems] = useState<ArticleData[]>(articles);

  const handleChange = useCallback((value: string, id: string, field: keyof ArticleData) => {
    setItems((prev) => prev.map((item) => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  }, []);

  const handleSave = () => {
    const payload = JSON.stringify(items);
    const formData = new FormData();
    formData.append("payload", payload);
    submit(formData, { method: "POST" });
  };

  const isSaving = navigation.state === "submitting";

  return (
    <Page
      backAction={{ content: 'Blogs', onAction: () => navigate('/app/blogs') }}
      title="Bulk edit articles"
      primaryAction={{
        content: 'Save',
        onAction: handleSave,
        loading: isSaving
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: 'article', plural: 'articles' }}
              itemCount={items.length}
              headings={[
                { title: 'Title' },
                { title: 'Author' },
                { title: 'URL Handle' }
              ]}
              selectable={false}
            >
              {items.map((item, index) => (
                <IndexTable.Row id={item.id} key={item.id} position={index}>
                  <IndexTable.Cell>
                    <div style={{ minWidth: '300px', padding: '8px 0' }}>
                      <TextField
                        label="Title"
                        labelHidden
                        value={item.title}
                        onChange={(val) => handleChange(val, item.id, 'title')}
                        autoComplete="off"
                      />
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ minWidth: '150px', padding: '8px 0' }}>
                      <TextField
                        label="Author"
                        labelHidden
                        value={item.author}
                        onChange={(val) => handleChange(val, item.id, 'author')}
                        autoComplete="off"
                      />
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ minWidth: '200px', padding: '8px 0' }}>
                      <TextField
                        label="Handle"
                        labelHidden
                        value={item.handle}
                        onChange={(val) => handleChange(val, item.id, 'handle')}
                        autoComplete="off"
                      />
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
