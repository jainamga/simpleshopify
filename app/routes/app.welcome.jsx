import {
    Page,
    Card,
    BlockStack,
    Text,
    Button,
    Grid,
    Box,
  } from "@shopify/polaris";
  import { Link } from "@remix-run/react";
  
  export default function WelcomePage() {
    return (
      <Page>
        <BlockStack gap={{ xs: "800", sm: "400" }}>
          {/* Main Welcome Banner */}
          <Card>
            <BlockStack gap="500">
              <Text variant="headingXl" as="h1">
                Welcome to Your SEO Toolkit!
              </Text>
              <Text as="p" tone="subdued">
                This is your command center for improving your store's on-page
                SEO. Boost your visibility and attract more customers by
                optimizing your product metadata and image alt text.
              </Text>
              <Text as="p">
                Select one of the tools below to get started.
              </Text>
            </BlockStack>
          </Card>
  
          {/* Feature Navigation Cards */}
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
              <Card>
                <BlockStack gap="400">
                  <Box minHeight="120px">
                    <Text variant="headingMd" as="h2">
                      Product Metadata Editor
                    </Text>
                    <Text as="p" tone="subdued">
                      Efficiently update meta titles and descriptions. Write
                      compelling snippets that improve your click-through rates
                      from search results.
                    </Text>
                  </Box>
                  <Link to="/app/metadata-editor" style={{ textDecoration: 'none' }}>
                    <Button variant="primary" fullWidth>
                      Optimize Meta Tags
                    </Button>
                  </Link>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
              <Card>
                <BlockStack gap="400">
                  <Box minHeight="120px">
                    <Text variant="headingMd" as="h2">
                      Image Alt Text Editor
                    </Text>
                    <Text as="p" tone="subdued">
                      Bulk-edit image alt text to improve accessibility and rank
                      higher in image searches. Use our AI generator for fast,
                      effective results.
                    </Text>
                  </Box>
                  <Link to="/app/image-alt-text-editor" style={{ textDecoration: 'none' }}>
                    <Button variant="primary" fullWidth>
                      Optimize Images
                    </Button>
                  </Link>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
  
          {/* Quick Tip Card */}
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h3">
                Pro Tip
              </Text>
              <Text as="p" tone="subdued">
                Keeping your meta titles under 60 characters and descriptions
                under 160 characters helps ensure they display properly in Google
                search results.
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    );
  }