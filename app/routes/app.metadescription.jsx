import React, { useState, useEffect } from 'react';
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  Button,
  TextField,
  InlineStack,
  Banner,
  Checkbox,
  ButtonGroup,
  ProgressBar
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { AzureOpenAI } from 'openai';

// Loader to fetch products and their SEO metadata with pagination
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const cursor = url.searchParams.get("cursor") || null;

  const limit = 20; // Number of products per page

  try {
    const response = await admin.graphql(
      `#graphql
      query ($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              seo {
                title
                description
              }
            }
          }
        }
      }`,
      {
        variables: {
          first: limit,
          after: cursor,
        },
      }
    );

    const data = await response.json();
    if (!data.data || !data.data.products) {
      throw new Error("Invalid response from Shopify API");
    }

    const products = data.data.products.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      metaTitle: node.seo?.title || "",
      metaDescription: node.seo?.description || "",
      featuredImageUrl: node.featuredImage?.url,
      featuredImageAlt: node.featuredImage?.altText || `Image of ${node.title}`,
    }));

    const { hasNextPage, endCursor } = data.data.products.pageInfo;

    return json({ products, hasNextPage, nextCursor: endCursor, currentPage: page });
  } catch (error) {
    console.error("Loader Error:", error);
    return json({ error: `Failed to load products: ${error.message}` }, { status: 500 });
  }
};

// Action to handle metadata updates and AI generation
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // AI Metadata Generation
  if (actionType === "generate") {
    if (!process.env.AZURE_OAI_ENDPOINT || !process.env.AZURE_OAI_KEY) {
      return json({ error: "Missing required Azure OpenAI configuration." }, { status: 500 });
    }

    const productId = formData.get("productId");
    const productTitle = formData.get("productTitle");
    if (!productId || !productTitle) {
      return json({ error: "Product ID and title are required for generation." }, { status: 400 });
    }

    try {
      const client = new AzureOpenAI({
        endpoint: process.env.AZURE_OAI_ENDPOINT,
        apiKey: process.env.AZURE_OAI_KEY,
        apiVersion: process.env.AZURE_OAI_API_VERSION,
        deployment: process.env.AZURE_OAI_DEPLOYMENT_NAME,
      });

      const prompt = `
        You are an expert e-commerce SEO assistant. For the given product, generate an SEO-optimized meta title and meta description.
        - Meta Title: Max 60 characters. Should be catchy and include the main keyword.
        - Meta Description: Max 160 characters. Should be a compelling summary that encourages clicks.
        
        Product Title: ${productTitle}
        
        Return ONLY a JSON object with two fields: "metaTitle" and "metaDescription".
        {"metaTitle": "your title here", "metaDescription": "your description here"}
      `;

      const completion = await client.chat.completions.create({
        messages: [
          { role: "system", content: "You are an expert e-commerce SEO assistant. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 150,
      });

      const result = completion.choices[0]?.message?.content || "{}";
      const parsedResult = JSON.parse(result);

      return json({
        generated: true,
        productId,
        generatedMetaTitle: parsedResult.metaTitle || "AI-generated title unavailable.",
        generatedMetaDescription: parsedResult.metaDescription || "AI-generated description unavailable.",
      });

    } catch (error) {
      console.error("OpenAI API Error:", error);
      return json({ error: `Failed to generate metadata: ${error.message}` }, { status: 500 });
    }
  }

  // Single Metadata Update
  if (actionType === "update") {
    const productId = formData.get("productId");
    const metaTitle = formData.get("metaTitle");
    const metaDescription = formData.get("metaDescription");

    if (!productId) {
      return json({ error: "Missing product ID." }, { status: 400 });
    }

    try {
      const mutationResponse = await admin.graphql(
        `#graphql
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                seo {
                  title
                  description
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            input: {
              id: productId,
              seo: {
                title: metaTitle,
                description: metaDescription,
              },
            },
          },
        }
      );

      const mutationData = await mutationResponse.json();
      const userErrors = mutationData.data.productUpdate.userErrors;

      if (userErrors.length > 0) {
        return json({ error: userErrors.map((e) => e.message).join(", ") }, { status: 400 });
      }

      return json({
        updated: true,
        productId,
        metaTitle,
        metaDescription,
      });
    } catch (error) {
      console.error("Mutation Error:", error);
      return json({ error: `Failed to update metadata: ${error.message}` }, { status: 500 });
    }
  }

  // Bulk Metadata Update
  if (actionType === "bulkUpdate") {
    const updates = formData.getAll("updates").map(u => JSON.parse(u));
    if (!updates || updates.length === 0) {
      return json({ error: "No updates provided." }, { status: 400 });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const { productId, metaTitle, metaDescription } = update;
        await admin.graphql(
            `#graphql
              mutation productUpdate($input: ProductInput!) {
                productUpdate(input: $input) {
                  product { id }
                  userErrors { message }
                }
              }`,
            { variables: { input: { id: productId, seo: { title: metaTitle, description: metaDescription } } } }
        );
        results.push(update);
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
      } catch (error) {
        errors.push(`Product ID ${update.productId}: ${error.message}`);
      }
    }

    return json({
      bulkUpdated: true,
      updatedCount: results.length,
      errors: errors.length > 0 ? errors : null,
    });
  }

  // Bulk Generate and Update All
  if (actionType === "bulkGenerateAndUpdateAll") {
    const products = JSON.parse(formData.get("products"));
    if (!products || products.length === 0) {
      return json({ error: "No products provided." }, { status: 400 });
    }

    const results = [];
    const errors = [];
    const client = new AzureOpenAI({
        endpoint: process.env.AZURE_OAI_ENDPOINT,
        apiKey: process.env.AZURE_OAI_KEY,
        apiVersion: process.env.AZURE_OAI_API_VERSION,
        deployment: process.env.AZURE_OAI_DEPLOYMENT_NAME,
    });

    for (const product of products) {
      try {
        // 1. Generate new metadata
        const prompt = `
            You are an expert e-commerce SEO assistant. For "${product.title}", generate an SEO-optimized meta title (max 60 chars) and meta description (max 160 chars).
            Return ONLY a JSON object: {"metaTitle": "...", "metaDescription": "..."}
        `;
        const completion = await client.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
          max_tokens: 150,
        });

        const result = completion.choices[0]?.message?.content || "{}";
        const { metaTitle, metaDescription } = JSON.parse(result);

        if (!metaTitle || !metaDescription) {
            errors.push(`Product ${product.id}: AI failed to generate valid metadata.`);
            continue;
        }

        // 2. Update the product
        await admin.graphql(
            `#graphql
              mutation productUpdate($input: ProductInput!) {
                productUpdate(input: $input) {
                  product { id }
                  userErrors { message }
                }
              }`,
            { variables: { input: { id: product.id, seo: { title: metaTitle, description: metaDescription } } } }
        );

        results.push({ id: product.id, metaTitle, metaDescription });
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
      } catch (error) {
        errors.push(`Product ${product.id}: ${error.message}`);
      }
    }

    return json({
        bulkGeneratedAndUpdated: true,
        updatedCount: results.length,
        errors: errors.length > 0 ? errors : null
    });
  }

  return json({ error: "Invalid action type." }, { status: 400 });
};

// React Component
export default function ProductMetadataEditor() {
  const { products = [], hasNextPage, nextCursor, currentPage, error: loaderError } = useLoaderData() || {};
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const [formState, setFormState] = useState({});
  const [generatedMetadata, setGeneratedMetadata] = useState({});
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const isSubmitting = navigation.state === 'submitting';
  
  // Handlers
  const handleInputChange = (productId, field, value) => {
    const maxLength = field === 'metaTitle' ? 60 : 160;
    setFormState(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value.slice(0, maxLength) },
    }));
  };

  const handleGenerate = (product) => {
    const formData = new FormData();
    formData.append("actionType", "generate");
    formData.append("productId", product.id);
    formData.append("productTitle", product.title);
    submit(formData, { method: "post" });
  };

  const handleUpdate = (product) => {
    const formData = new FormData();
    formData.append("actionType", "update");
    formData.append("productId", product.id);
    formData.append("metaTitle", formState[product.id]?.metaTitle ?? product.metaTitle);
    formData.append("metaDescription", formState[product.id]?.metaDescription ?? product.metaDescription);
    submit(formData, { method: "post" });
  };

  const useGeneratedMetadata = (productId, data) => {
    setFormState(prev => ({
      ...prev,
      [productId]: {
        metaTitle: data.generatedMetaTitle.slice(0, 60),
        metaDescription: data.generatedMetaDescription.slice(0, 160),
      },
    }));
  };

  const handlePageChange = (direction) => {
    const newPage = currentPage + direction;
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage);
    if (direction > 0 && nextCursor) {
        params.set("cursor", nextCursor);
    } else {
        // For 'previous', we rely on the browser's back functionality with the correct URL
        // A more robust solution would involve storing previous cursors.
        params.delete("cursor");
        // This simplified version will refetch from the start if going back from page > 2
    }
    setSearchParams(params);
  };

  const handleProductSelection = (productId, isSelected) => {
    const newSelected = new Set(selectedProducts);
    isSelected ? newSelected.add(productId) : newSelected.delete(productId);
    setSelectedProducts(newSelected);
    setSelectAll(newSelected.size === products.length && products.length > 0);
  };

  const handleSelectAll = (isSelected) => {
    const allProductIds = isSelected ? new Set(products.map(p => p.id)) : new Set();
    setSelectedProducts(allProductIds);
    setSelectAll(isSelected);
  };

  const handleBulkUpdate = () => {
    if (selectedProducts.size === 0) return;
    const formData = new FormData();
    formData.append("actionType", "bulkUpdate");
    Array.from(selectedProducts).forEach(productId => {
        const product = products.find(p => p.id === productId);
        const update = {
            productId,
            metaTitle: formState[productId]?.metaTitle ?? product.metaTitle,
            metaDescription: formState[productId]?.metaDescription ?? product.metaDescription,
        };
        formData.append("updates", JSON.stringify(update));
    });
    submit(formData, { method: "post" });
  };

  const handleBulkGenerateAndUpdateAll = () => {
    const formData = new FormData();
    formData.append("actionType", "bulkGenerateAndUpdateAll");
    formData.append("products", JSON.stringify(products.map(p => ({id: p.id, title: p.title}))));
    submit(formData, { method: "post" });
  };
  
  // Effects
  useEffect(() => {
    if (actionData?.generated) {
      setGeneratedMetadata(prev => ({ ...prev, [actionData.productId]: actionData }));
    }
  }, [actionData]);

  useEffect(() => {
    setSelectedProducts(new Set());
    setSelectAll(false);
  }, [currentPage]);

  // Loading states
  const isBulkUpdating = isSubmitting && navigation.formData?.get("actionType") === "bulkUpdate";
  const isBulkGeneratingAll = isSubmitting && navigation.formData?.get("actionType") === "bulkGenerateAndUpdateAll";

  // DataTable Rows
  const rows = products.map((product) => {
    const isSelected = selectedProducts.has(product.id);
    const isGenerating = isSubmitting && navigation.formData?.get("actionType") === "generate" && navigation.formData?.get("productId") === product.id;
    const isUpdating = isSubmitting && navigation.formData?.get("actionType") === "update" && navigation.formData?.get("productId") === product.id;
    const hasGenerated = generatedMetadata[product.id];

    return [
      <Checkbox
        checked={isSelected}
        onChange={(checked) => handleProductSelection(product.id, checked)}
      />,
      <InlineStack blockAlign="center" gap="400" wrap={false}>
          {product.featuredImageUrl ? (
            <img
              src={product.featuredImageUrl}
              alt={product.featuredImageAlt}
              style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
            />
          ) : (
            <div style={{
                width: '60px', 
                height: '60px', 
                border: '1px solid var(--p-color-border)', 
                borderRadius: '4px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                background: 'var(--p-color-bg-surface-secondary)'
            }}>
                <Text tone="subdued" as="span" variant="bodySm">No img</Text>
            </div>
          )}
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
            <Text variant="bodySm" tone="subdued">Handle: {product.handle}</Text>
          </BlockStack>
        </InlineStack>,
      <BlockStack gap="300">
        <TextField
          label="Meta Title"
          labelHidden
          value={formState[product.id]?.metaTitle ?? product.metaTitle}
          onChange={(value) => handleInputChange(product.id, 'metaTitle', value)}
          maxLength={60}
          showCharacterCount
          autoComplete="off"
          placeholder="Enter meta title (max 60 chars)"
        />
        <TextField
          label="Meta Description"
          labelHidden
          value={formState[product.id]?.metaDescription ?? product.metaDescription}
          onChange={(value) => handleInputChange(product.id, 'metaDescription', value)}
          maxLength={160}
          showCharacterCount
          multiline={3}
          autoComplete="off"
          placeholder="Enter meta description (max 160 chars)"
        />
        {hasGenerated && (
          <Card background="bg-surface-secondary">
            <BlockStack gap="200">
              <Text variant="bodySm" fontWeight="bold">AI Suggestion:</Text>
              <Text variant="bodySm"><strong>Title:</strong> {generatedMetadata[product.id].generatedMetaTitle}</Text>
              <Text variant="bodySm"><strong>Desc:</strong> {generatedMetadata[product.id].generatedMetaDescription}</Text>
              <Button size="micro" onClick={() => useGeneratedMetadata(product.id, generatedMetadata[product.id])}>Use This</Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>,
      <InlineStack gap="200" vertical>
        <Button onClick={() => handleGenerate(product)} loading={isGenerating} size="slim">Generate</Button>
        <Button onClick={() => handleUpdate(product)} loading={isUpdating} variant="primary" size="slim">Update</Button>
      </InlineStack>,
    ];
  });
  
  const progressPercentage = isSubmitting ? 50 : 0; // Simplified progress

  return (
    <Page title="Product SEO Metadata Editor">
      <BlockStack gap="500">
        {/* Instructions, Pagination, and Bulk Operations */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">Instructions</Text>
            <Text>Use this tool to edit SEO meta titles and descriptions for your products individually or in bulk.</Text>
            <InlineStack gap="400" align="space-between" blockAlign="center">
                <ButtonGroup>
                    <Button onClick={() => handlePageChange(-1)} disabled={currentPage === 1}>Previous</Button>
                    <Button onClick={() => handlePageChange(1)} disabled={!hasNextPage}>Next</Button>
                </ButtonGroup>
                <Text>Page {currentPage}</Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd">Bulk Operations</Text>
                <InlineStack gap="300" align="space-between" blockAlign="center">
                    <Text>{selectedProducts.size} of {products.length} products selected</Text>
                    <ButtonGroup>
                        <Button onClick={handleBulkUpdate} loading={isBulkUpdating} disabled={selectedProducts.size === 0} variant="primary">Update Selected</Button>
                        <Button onClick={handleBulkGenerateAndUpdateAll} loading={isBulkGeneratingAll} variant="primary">Generate & Update All on Page</Button>
                    </ButtonGroup>
                </InlineStack>
                {(isBulkUpdating || isBulkGeneratingAll) && <ProgressBar progress={progressPercentage} size="medium" tone="primary" />}
            </BlockStack>
        </Card>

        {/* Main Data Table */}
        <Card>
          {rows.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={[
                <Checkbox
                    checked={selectAll}
                    indeterminate={selectedProducts.size > 0 && selectedProducts.size < products.length}
                    onChange={handleSelectAll}
                />,
                "Product",
                "Meta Title & Description",
                "Actions",
              ]}
              rows={rows}
            />
          ) : (
            <Text alignment="center">No products found on this page.</Text>
          )}
        </Card>

        {/* Banners */}
        {loaderError && <Banner status="critical" title="Error Loading Products"><Text>{loaderError}</Text></Banner>}
        {actionData?.error && <Banner status="critical" title="An Error Occurred"><Text>{actionData.error}</Text></Banner>}
        {actionData?.updated && <Banner status="success" title="Success!" onDismiss={() => {}}>Product metadata updated.</Banner>}
        {actionData?.generated && <Banner status="success" title="Success!" onDismiss={() => {}}>AI suggestions generated. Review and apply.</Banner>}
        {actionData?.bulkUpdated && (
            <Banner status="success" title="Bulk Update Complete" onDismiss={() => {}}>
                <p>Successfully updated {actionData.updatedCount} products.</p>
                {actionData.errors && <ul>{actionData.errors.map((e,i) => <li key={i}>{e}</li>)}</ul>}
            </Banner>
        )}
        {actionData?.bulkGeneratedAndUpdated && (
            <Banner status="success" title="Bulk Generation Complete" onDismiss={() => {}}>
                <p>Successfully generated and updated {actionData.updatedCount} products.</p>
                {actionData.errors && <ul>{actionData.errors.map((e,i) => <li key={i}>{e}</li>)}</ul>}
            </Banner>
        )}
      </BlockStack>
    </Page>
  );
}