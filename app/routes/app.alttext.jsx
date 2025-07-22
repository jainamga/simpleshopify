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

// Loader to fetch products and their media with pagination
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const fetchAll = url.searchParams.get("fetchAll") === "true";

  const limit = 30; // 30 images per page

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
              description
              productType
              vendor
              media(first: 10) {
                edges {
                  node {
                    id
                    alt
                    mediaContentType
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      `,
      {
        variables: {
          first: limit,
          after: page > 1 ? url.searchParams.get("cursor") : null,
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
      description: node.description || "",
      productType: node.productType || "N/A",
      vendor: node.vendor || "N/A",
      media: node.media.edges.map(({ node }) => ({
        id: node.id,
        altText: node.alt || "",
        url: node.image?.url || "",
        mediaContentType: node.mediaContentType
      })),
    }));

    const totalImages = products.reduce((sum, p) => sum + p.media.length, 0);
    const hasNextPage = data.data.products.pageInfo.hasNextPage;
    const nextCursor = hasNextPage ? data.data.products.pageInfo.endCursor : null;

    return json({ products, totalImages, hasNextPage, nextCursor, currentPage: page });
  } catch (error) {
    console.error("Loader Error:", error);
    return json({ error: `Failed to load products: ${error.message}` }, { status: 500 });
  }
};

// Action to handle alt text updates and AI generation
export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");
  
    // Debug environment variables
    console.log("Environment debug:", {
      NODE_ENV: process.env.NODE_ENV,
      AZURE_OAI_ENDPOINT: process.env.AZURE_OAI_ENDPOINT ? "SET" : "UNDEFINED",
      AZURE_OAI_KEY: process.env.AZURE_OAI_KEY ? "SET" : "UNDEFINED",
      AZURE_OAI_API_VERSION: process.env.AZURE_OAI_API_VERSION ? "SET" : "UNDEFINED",
      AZURE_OAI_DEPLOYMENT_NAME: process.env.AZURE_OAI_DEPLOYMENT_NAME ? "SET" : "UNDEFINED",
      allEnvKeys: Object.keys(process.env).filter(key => key.startsWith('AZURE')),
    });
  
    // Handle AI Alt Text Generation
    if (actionType === "generate") {
      // Check if required environment variables exist
      if (!process.env.AZURE_OAI_ENDPOINT || !process.env.AZURE_OAI_KEY) {
        return json({ 
          error: "Missing required Azure OpenAI configuration. Please check your environment variables." 
        }, { status: 500 });
      }
  
      const productId = formData.get("productId");
      const imageId = formData.get("imageId");
      const productTitle = formData.get("productTitle");
      const productDescription = formData.get("productDescription");
      const productType = formData.get("productType");
      const vendor = formData.get("vendor");
      const imageUrl = formData.get("imageUrl");
      if (!productTitle || !imageId) {
        return json({ error: "Product title and image ID are required for alt text generation." }, { status: 400 });
      }
  
      try {
        const client = new AzureOpenAI({
          endpoint: process.env.AZURE_OAI_ENDPOINT,
          apiKey: process.env.AZURE_OAI_KEY,
          apiVersion: process.env.AZURE_OAI_API_VERSION,
          deployment: process.env.AZURE_OAI_DEPLOYMENT_NAME,
        });
  
        // Rest of your code...
      } catch (error) {
        console.error("OpenAI Client Error:", error);
        return json({ error: `Failed to initialize AI client: ${error.message}` }, { status: 500 });
      }
    }
  
  // Handle AI Alt Text Generation
  if (actionType === "generate") {
    const productId = formData.get("productId");
    const imageId = formData.get("imageId");
    const productTitle = formData.get("productTitle");
    const productDescription = formData.get("productDescription");
    const productType = formData.get("productType");
    const vendor = formData.get("vendor");
    const imageUrl = formData.get("imageUrl");

    if (!productTitle || !imageId) {
      return json({ error: "Product title and image ID are required for alt text generation." }, { status: 400 });
    }

    const client = new AzureOpenAI({
      endpoint: process.env.AZURE_OAI_ENDPOINT,
      apiKey: process.env.AZURE_OAI_KEY,
      apiVersion: process.env.AZURE_OAI_API_VERSION,
      deployment: process.env.AZURE_OAI_DEPLOYMENT_NAME,
    });

    try {
      const prompt = `
        You are an expert e-commerce SEO assistant. For the given product image, generate a concise, SEO-optimized alt text (max 125 characters, min 90).
        Focus on descriptive, keyword-rich text that enhances accessibility and searchability.
        
        Product Title: ${productTitle}
        Product Description: ${productDescription || 'Not provided'}
        Product Type: ${productType || 'Not specified'}
        Vendor: ${vendor || 'Not specified'}
        Image URL: ${imageUrl || 'Not provided'}
        
        Return ONLY a JSON object with a single "altText" field:
        {"altText": "your alt text here"}
      `;

      const completion = await client.chat.completions.create({
        messages: [
          { role: "system", content: "You are an expert e-commerce SEO assistant. Always respond with valid JSON only." },
          { role: "user", content: [
            { type: "text", text: prompt },
            ...(imageUrl ? [{ type: "image_url", image_url: { url: imageUrl, detail: "low" } }] : [])
          ] },
        ],
        temperature: 0.3,
        max_tokens: 100,
      });

      const result = completion.choices[0]?.message?.content || "{}";
      
      try {
        const parsedResult = JSON.parse(result);
        return json({ 
          generated: true, 
          productId,
          imageId,
          generatedAltText: parsedResult.altText || "AI-generated alt text unavailable"
        });
      } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        return json({ 
          generated: true, 
          productId,
          imageId,
          generatedAltText: "AI-error-invalid-json",
          rawResult: result
        });
      }

    } catch (error) {
      console.error("OpenAI API Error:", error);
      return json({ error: `Failed to generate alt text: ${error.message}` }, { status: 500 });
    }
  }

  // Handle Alt Text Update
  if (actionType === "update") {
    const productId = formData.get("productId");
    const imageId = formData.get("imageId");
    const altText = formData.get("altText");

    if (!productId || !imageId) {
      return json({ error: "Missing product ID or image ID." }, { status: 400 });
    }

    if (!imageId.startsWith("gid://shopify/MediaImage/")) {
      return json({ error: "Invalid image ID format. Expected gid://shopify/MediaImage/..." }, { status: 400 });
    }

    try {
      const mutationResponse = await admin.graphql(
        `#graphql
          mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $productId, media: $media) {
              media {
                id
                alt
              }
              mediaUserErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            productId,
            media: [{ id: imageId, alt: altText || "" }]
          },
        }
      );

      const mutationData = await mutationResponse.json();
      const mediaUserErrors = mutationData.data.productUpdateMedia.mediaUserErrors;

      if (mediaUserErrors.length > 0) {
        console.error("Media User Errors:", mediaUserErrors);
        return json({ error: mediaUserErrors.map((e) => e.message).join(", ") }, { status: 400 });
      }

      if (!mutationData.data.productUpdateMedia.media) {
        return json({ error: "Failed to update image alt text." }, { status: 400 });
      }

      return json({
        updated: true,
        productId,
        imageId,
        altText,
      });
    } catch (error) {
      console.error("Mutation Error:", error);
      return json({ error: `Failed to update alt text: ${error.message}` }, { status: 500 });
    }
  }

  // Handle Bulk Alt Text Update
  if (actionType === "bulkUpdate") {
    const updates = formData.getAll("updates");
    
    if (!updates || updates.length === 0) {
      return json({ error: "No updates provided for bulk operation." }, { status: 400 });
    }

    const bulkUpdateResults = [];
    const errors = [];

    // Process updates in smaller batches to avoid overwhelming the API
    const BATCH_SIZE = 5; // Reduce this from the previous value
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Process each update in the batch
      for (const updateStr of batch) {
        try {
          const update = JSON.parse(updateStr);
          const { productId, imageId, altText } = update;

          if (!imageId.startsWith("gid://shopify/MediaImage/")) {
            errors.push(`Image ${imageId} for product ${productId}: Invalid image ID format`);
            continue;
          }

          const mutationResponse = await admin.graphql(
            `#graphql
              mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
                productUpdateMedia(productId: $productId, media: $media) {
                  media {
                    id
                    alt
                  }
                  mediaUserErrors {
                    field
                    message
                  }
                }
              }
            `,
            {
              variables: {
                productId,
                media: [{ id: imageId, alt: altText || "" }]
              },
            }
          );

          const mutationData = await mutationResponse.json();
          
          if (mutationData.data && mutationData.data.productUpdateMedia) {
            const mediaUserErrors = mutationData.data.productUpdateMedia.mediaUserErrors;

            if (mediaUserErrors && mediaUserErrors.length > 0) {
              errors.push(`Image ${imageId} for product ${productId}: ${mediaUserErrors.map((e) => e.message).join(", ")}`);
            } else if (mutationData.data.productUpdateMedia.media) {
              bulkUpdateResults.push({
                productId,
                imageId,
                altText
              });
            }
          } else {
            errors.push(`Image ${imageId} for product ${productId}: Invalid response from API`);
          }

        } catch (error) {
          console.error(`Error updating image in bulk operation:`, error);
          errors.push(`Error in bulk update: ${error.message}`);
        }
        
        // Add a small delay between API calls to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return json({
      bulkUpdated: true,
      bulkUpdateResults: bulkUpdateResults.map(r => ({ id: r.imageId, altText: r.altText })),
      errors: errors.length > 0 ? errors : null,
      updatedCount: bulkUpdateResults.length
    });
  }

  // Handle Bulk Generate and Update for All Images
  if (actionType === "bulkGenerateAndUpdateAll") {
    const productDataStr = formData.get("products");
    
    if (!productDataStr) {
      return json({ error: "No products provided for bulk generation." }, { status: 400 });
    }
    
    let productData;
    try {
      productData = JSON.parse(productDataStr);
    } catch (error) {
      return json({ error: `Failed to parse product data: ${error.message}` }, { status: 400 });
    }
    
    if (!productData || productData.length === 0) {
      return json({ error: "No products provided for bulk generation." }, { status: 400 });
    }

    const bulkResults = [];
    const errors = [];
    const client = new AzureOpenAI({
      endpoint: process.env.AZURE_OAI_ENDPOINT,
      apiKey: process.env.AZURE_OAI_KEY,
      apiVersion: process.env.AZURE_OAI_API_VERSION,
      deployment: process.env.AZURE_OAI_DEPLOYMENT_NAME,
    });

    // Reduce batch size for better stability
    const BATCH_SIZE = 10;
    for (let i = 0; i < productData.length; i += BATCH_SIZE) {
      const batch = productData.slice(i, i + BATCH_SIZE);

      for (const { productId, imageId, productTitle, productDescription, productType, vendor, imageUrl } of batch) {
        try {
          const prompt = `
            You are an expert e-commerce SEO assistant. For the given product image, generate a concise, SEO-optimized alt text (max 125 characters, min 90).
            Focus on descriptive, keyword-rich text that enhances accessibility and searchability.
            
            Product Title: ${productTitle}
            Product Description: ${productDescription || 'Not provided'}
            Product Type: ${productType || 'Not specified'}
            Vendor: ${vendor || 'Not specified'}
            Image URL: ${imageUrl || 'Not provided'}
            
            Return ONLY a JSON object with a single "altText" field:
            {"altText": "your alt text here"}
          `;

          const completion = await client.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert e-commerce SEO assistant. Always respond with valid JSON only." },
              { role: "user", content: [
                { type: "text", text: prompt },
                ...(imageUrl ? [{ type: "image_url", image_url: { url: imageUrl, detail: "low" } }] : [])
              ] },
            ],
            temperature: 0.3,
            max_tokens: 100,
          });

          const result = completion.choices[0]?.message?.content || "{}";
          let altText;

          try {
            const parsedResult = JSON.parse(result);
            altText = parsedResult.altText || "AI-generated alt text unavailable";
          } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            errors.push(`Image ${imageId} for product ${productId}: Failed to parse AI response`);
            continue;
          }

          const mutationResponse = await admin.graphql(
            `#graphql
              mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
                productUpdateMedia(productId: $productId, media: $media) {
                  media {
                    id
                    alt
                  }
                  mediaUserErrors {
                    field
                    message
                  }
                }
              }
            `,
            {
              variables: {
                productId,
                media: [{ id: imageId, alt: altText || "" }]
              },
            }
          );

          const mutationData = await mutationResponse.json();
          
          if (mutationData.data && mutationData.data.productUpdateMedia) {
            const mediaUserErrors = mutationData.data.productUpdateMedia.mediaUserErrors;

            if (mediaUserErrors && mediaUserErrors.length > 0) {
              errors.push(`Image ${imageId} for product ${productId}: ${mediaUserErrors.map((e) => e.message).join(", ")}`);
            } else if (mutationData.data.productUpdateMedia.media) {
              bulkResults.push({
                productId,
                imageId,
                altText
              });
            }
          } else {
            errors.push(`Image ${imageId} for product ${productId}: Invalid response from API`);
          }

          // Add a delay between API calls to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          console.error(`Error processing image ${imageId} for product ${productId}:`, error);
          errors.push(`Image ${imageId} for product ${productId}: ${error.message}`);
        }
      }
    }

    return json({
      bulkGeneratedAndUpdated: true,
      bulkResults: bulkResults.map(r => ({ id: r.imageId, altText: r.altText })),
      errors: errors.length > 0 ? errors : null,
      updatedCount: bulkResults.length
    });
  }

  return json({ error: "Invalid action type." }, { status: 400 });
};

// React component
export default function ProductImageAltTextEditor() {
  const loaderData = useLoaderData();
  const { 
    products = [], 
    totalImages = 0, 
    hasNextPage = false, 
    nextCursor = null, 
    currentPage = 1, 
    error: loaderError
  } = loaderData || {};
  
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formState, setFormState] = useState({});
  const [generatedAltText, setGeneratedAltText] = useState({});
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);

  // Calculate total pages based on totalImages and limit (30 per page)
  const limit = 30;
  const totalPages = Math.ceil(totalImages / limit) || 1;

  // Handle page change
  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === currentPage) return;
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage);
    if (newPage > 1 && nextCursor) {
      params.set("cursor", nextCursor);
    } else {
      params.delete("cursor");
    }
    setSearchParams(params);
  };

  // Handle image selection
  const handleImageSelection = (imageKey, isSelected) => {
    const newSelected = new Set(selectedImages);
    if (isSelected) {
      newSelected.add(imageKey);
    } else {
      newSelected.delete(imageKey);
    }
    setSelectedImages(newSelected);
    
    const totalImagesOnPage = products ? products.reduce((sum, p) => sum + p.media.length, 0) : 0;
    setSelectAll(newSelected.size === totalImagesOnPage && totalImagesOnPage > 0);
  };

  // Handle select all
  const handleSelectAll = (isSelected) => {
    if (isSelected && products) {
      const allImageKeys = new Set();
      products.forEach(product => {
        product.media.forEach(image => {
          allImageKeys.add(`${product.id}_${image.id}`);
        });
      });
      setSelectedImages(allImageKeys);
    } else {
      setSelectedImages(new Set());
    }
    setSelectAll(isSelected);
  };

  // Handle bulk update
  const handleBulkUpdate = () => {
    if (selectedImages.size === 0) {
      alert("Please select at least one image for bulk update.");
      return;
    }

    const formData = new FormData();
    formData.append("actionType", "bulkUpdate");

    // Convert Set to Array for iteration
    Array.from(selectedImages).forEach(imageKey => {
      const [productId, imageId] = imageKey.split("_");
      const product = products.find(p => p.id === productId);
      
      if (!product) {
        console.error(`Product not found for ID: ${productId}`);
        return;
      }
      
      const image = product.media.find(img => img.id === imageId);
      
      if (!image) {
        console.error(`Image not found for ID: ${imageId} in product ${productId}`);
        return;
      }
      
      const update = {
        productId,
        imageId,
        altText: formState[imageKey]?.altText !== undefined ? formState[imageKey].altText : image.altText
      };
      
      formData.append("updates", JSON.stringify(update));
    });

    submit(formData, { method: "post" });
  };

  // Handle bulk generate and update for all images
  const handleBulkGenerateAndUpdateAll = () => {
    if (!products || products.length === 0) {
      alert("No products available to process.");
      return;
    }

    const totalImages = products.reduce((sum, p) => sum + (p.media?.length || 0), 0);
    if (totalImages === 0) {
      alert("No images available to process.");
      return;
    }

    setIsBulkGenerating(true);
    setBulkProgress({ current: 0, total: totalImages });

    const formData = new FormData();
    formData.append("actionType", "bulkGenerateAndUpdateAll");

    const productData = [];
    products.forEach(product => {
      if (product.media && Array.isArray(product.media)) {
        product.media.forEach(image => {
          if (image && image.id) {
            productData.push({
              productId: product.id,
              imageId: image.id,
              productTitle: product.title,
              productDescription: product.description,
              productType: product.productType,
              vendor: product.vendor,
              imageUrl: image.url
            });
          }
        });
      }
    });

    formData.append("products", JSON.stringify(productData));
    submit(formData, { method: "post" });
  };

  // Handle input changes
  const handleInputChange = (imageKey, value) => {
    setFormState((prev) => ({
      ...prev,
      [imageKey]: {
        altText: value.slice(0, 125),
      },
    }));
  };

  // Handle AI alt text generation
  const handleGenerate = (product, image) => {
    const formData = new FormData();
    formData.append("actionType", "generate");
    formData.append("productId", product.id);
    formData.append("imageId", image.id);
    formData.append("productTitle", product.title);
    formData.append("productDescription", product.description);
    formData.append("productType", product.productType);
    formData.append("vendor", product.vendor);
    formData.append("imageUrl", image.url);
    submit(formData, { method: "post" });
  };

  // Handle alt text update
  const handleUpdate = (product, image) => {
    const imageKey = `${product.id}_${image.id}`;
    const formData = new FormData();
    formData.append("actionType", "update");
    formData.append("productId", product.id);
    formData.append("imageId", image.id);
    formData.append("altText", formState[imageKey]?.altText !== undefined ? formState[imageKey].altText : image.altText);
    submit(formData, { method: "post" });
  };

  // Use generated alt text
  const useGeneratedAltText = (imageKey, altText) => {
    setFormState((prev) => ({
      ...prev,
      [imageKey]: {
        altText: altText.slice(0, 125),
      },
    }));
  };

  // Update form state with generated alt text and handle bulk progress
  useEffect(() => {
    if (actionData?.generated && actionData?.productId && actionData?.imageId) {
      const imageKey = `${actionData.productId}_${actionData.imageId}`;
      setGeneratedAltText((prev) => ({
        ...prev,
        [imageKey]: actionData.generatedAltText,
      }));
    }

    if (actionData?.bulkGeneratedAndUpdated) {
      setIsBulkGenerating(false);
      setBulkProgress({ current: 0, total: 0 });
    }
  }, [actionData]);

  // Reset selections when page changes
  useEffect(() => {
    setSelectedImages(new Set());
    setSelectAll(false);
  }, [currentPage]);

  const isBulkUpdating = navigation.state === "submitting" && 
                        navigation.formData?.get("actionType") === "bulkUpdate";
  const isBulkGeneratingAll = navigation.state === "submitting" && 
                             navigation.formData?.get("actionType") === "bulkGenerateAndUpdateAll";

  const rows = products && products.length > 0 ? products.flatMap((product) => 
    (product.media || []).map((image) => {
      if (!product.id || !image.id) return null;
      
      const imageKey = `${product.id}_${image.id}`;
      const isGenerating = navigation.state === "submitting" && 
                          navigation.formData?.get("actionType") === "generate" && 
                          navigation.formData?.get("productId") === product.id &&
                          navigation.formData?.get("imageId") === image.id;
      
      const isUpdating = navigation.state === "submitting" && 
                        navigation.formData?.get("actionType") === "update" && 
                        navigation.formData?.get("productId") === product.id &&
                        navigation.formData?.get("imageId") === image.id;

      const hasGeneratedAltText = generatedAltText[imageKey];
      const isSelected = selectedImages.has(imageKey);

      return [
        <Checkbox
          checked={isSelected}
          onChange={(checked) => handleImageSelection(imageKey, checked)}
        />,
        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
          <Text variant="bodySm" tone="subdued">
            Type: {product.productType} | Vendor: {product.vendor}
          </Text>
          <img src={image.url} alt={image.altText || "Product image"} style={{ maxWidth: '100px', maxHeight: '100px' }} />
        </BlockStack>,
        <BlockStack gap="200">
          <TextField
            label="Alt Text"
            labelHidden
            value={formState[imageKey]?.altText !== undefined ? formState[imageKey].altText : (image.altText || "")}
            onChange={(value) => handleInputChange(imageKey, value)}
            maxLength={125}
            showCharacterCount
            autoComplete="off"
            placeholder="Enter alt text (max 125 chars)"
          />
          {hasGeneratedAltText && (
            <Card background="bg-surface-secondary">
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="bold">AI Generated Alt Text:</Text>
                <Text variant="bodySm">{generatedAltText[imageKey]}</Text>
                <Button 
                  size="micro" 
                  onClick={() => useGeneratedAltText(imageKey, generatedAltText[imageKey])}
                >
                  Use This Alt Text
                </Button>
              </BlockStack>
            </Card>
          )}
        </BlockStack>,
        <InlineStack gap="100">
          <Button
            onClick={() => handleGenerate(product, image)}
            loading={isGenerating}
            variant="secondary"
            size="slim"
            icon="magicwand"
          >
            Generate Alt Text
          </Button>
          <Button
            onClick={() => handleUpdate(product, image)}
            loading={isUpdating}
            variant="primary"
            size="slim"
            icon="save"
          >
            Update Alt Text
          </Button>
        </InlineStack>,
      ];
    })
  ).filter(Boolean) : [];

  const progressPercentage = bulkProgress.total > 0 
    ? (bulkProgress.current / bulkProgress.total) * 100 
    : 0;

  return (
    <Page title="Product Image Alt Text Editor">
      <BlockStack gap="500">
        {/* Instructions Card */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">How to use this tool:</Text>
            <Text as="p">
              1. Select individual images or use "Select All" for bulk operations (max 10 images per product)
            </Text>
            <Text as="p">
              2. Click "Generate Alt Text" to create AI-generated alt text for an image
            </Text>
            <Text as="p">
              3. Review AI suggestions and click "Use This Alt Text" or edit manually (max 125 characters)
            </Text>
            <Text as="p">
              4. Click "Update Alt Text" to save changes, or use "Update Selected" for bulk updates
            </Text>
            <Text as="p">
              5. Use "Generate & Update All Images" to automatically generate and update alt text for all images without selection
            </Text>
            <Text as="p">
              6. Use pagination to navigate through 30 images per page
            </Text>
          </BlockStack>
        </Card>

        {/* Pagination Controls */}
        {totalImages > 0 && (
          <Card>
            <InlineStack gap="200" align="center">
              <Button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                variant="tertiary"
              >
                Previous
              </Button>
              <Text>Page {currentPage} of {totalPages}</Text>
              <Button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!hasNextPage}
                variant="tertiary"
              >
                Next
              </Button>
            </InlineStack>
          </Card>
        )}

        {/* Bulk Operations Card */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd">Bulk Operations</Text>
            <InlineStack gap="300" align="space-between">
              <InlineStack gap="200">
                <Text as="p">
                  {selectedImages.size} of {rows.length} images selected
                </Text>
              </InlineStack>
              <ButtonGroup>
                <Button 
                  onClick={handleBulkUpdate}
                  loading={isBulkUpdating}
                  disabled={selectedImages.size === 0}
                  variant="primary"
                  icon="save"
                >
                  Update Selected ({selectedImages.size})
                </Button>
                <Button 
                  onClick={handleBulkGenerateAndUpdateAll}
                  loading={isBulkGeneratingAll}
                  variant="primary"
                  icon="magicwand"
                >
                  Generate & Update All Images
                </Button>
              </ButtonGroup>
            </InlineStack>
            {(isBulkGenerating || isBulkGeneratingAll) && (
              <ProgressBar 
                progress={progressPercentage} 
                size="medium"
                tone="primary"
              />
            )}
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
                  indeterminate={selectedImages.size > 0 && selectedImages.size < rows.length}
                  onChange={handleSelectAll}
                />,
                "Product & Image",
                "Alt Text (Max 125 chars)",
                "Actions"
              ]}
              rows={rows}
              truncate
            />
          ) : (
            <BlockStack gap="400" alignment="center" padding="400">
              <Text variant="bodyMd">No images available. Try adding images to your products or navigate to a different page.</Text>
            </BlockStack>
          )}
        </Card>

        {/* Loader Error Message */}
        {loaderError && (
          <Banner status="critical" title="Loader Error">
            <Text as="p">{loaderError}</Text>
          </Banner>
        )}

        {/* Success Messages */}
        {actionData?.generated && (
          <Banner status="success" title="Alt Text Generated">
            <Text as="p">
              AI has generated alt text for your image. Review the suggestion above and use it if it looks good!
            </Text>
          </Banner>
        )}

        {actionData?.updated && (
          <Banner status="success" title="Alt Text Updated Successfully">
            <Text as="p">
              Alt text has been updated for your image.
            </Text>
          </Banner>
        )}

        {actionData?.bulkUpdated && (
          <Banner status="success" title="Bulk Alt Text Update Complete">
            <Text as="p">
              Successfully updated alt text for {actionData.updatedCount} images.
              {actionData.errors && actionData.errors.length > 0 && (
                <>
                  <br /><br />
                  <Text fontWeight="bold">Some errors occurred:</Text>
                  <ul>
                    {actionData.errors.slice(0, 5).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                    {actionData.errors.length > 5 && <li>...and {actionData.errors.length - 5} more errors</li>}
                  </ul>
                </>
              )}
            </Text>
          </Banner>
        )}

        {actionData?.bulkGeneratedAndUpdated && (
          <Banner status="success" title="Bulkk Alt Text Generation and Update Complete">
            <Text as="p">
              Successfully generated and updated alt text for {actionData.updatedCount} images.
              {actionData.errors && actionData.errors.length > 0 && (
                <>
                  <br /><br />
                  <Text fontWeight="bold">Some errors occurred:</Text>
                  <ul>
                    {actionData.errors.slice(0, 5).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                    {actionData.errors.length > 5 && <li>...and {actionData.errors.length - 5} more errors</li>}
                  </ul>
                </>
              )}
            </Text>
          </Banner>
        )}

        {/* Action Error Messages */}
        {actionData?.error && (
          <Banner status="critical" title="Error">
            <Text as="p">{actionData.error}</Text>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}