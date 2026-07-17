use crate::error::Result;
use crate::utils::http_client::nrc_get;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub struct WordPressApi;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OgImage {
    pub url: Option<String>,
    #[serde(rename = "type")]
    pub image_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YoastHeadJson {
    pub title: Option<String>,
    pub description: Option<String>,
    pub og_description: Option<String>,
    pub og_url: Option<String>,
    pub og_image: Option<Vec<OgImage>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BlogPost {
    pub id: i64,
    pub date: String,
    pub yoast_head_json: Option<YoastHeadJson>,
}

impl WordPressApi {
    pub fn new() -> Self {
        Self
    }

    /// Retrieves the base URL for the WordPress API
    pub fn get_api_base() -> String {
        String::from("https://blog.norisk.gg/wp-json/wp/v2")
    }

    /// Fetch blog posts from WordPress API
    ///
    /// # Arguments
    ///
    /// * `categories` - Optional comma-separated list of category IDs to filter by
    /// * `per_page` - Optional number of posts to return per page
    /// * `page` - Optional page number
    ///
    /// # Returns
    ///
    /// * `Result<Vec<BlogPost>>` - A vector of blog posts or an error
    pub async fn get_blog_posts(
        categories: Option<&str>,
        per_page: Option<u32>,
        page: Option<u32>,
    ) -> Result<Vec<BlogPost>> {
        let base_url = Self::get_api_base();
        let endpoint = "posts";
        let url = format!("{}/{}", base_url, endpoint);

        info!("[WordPress API] Fetching blog posts");
        debug!("[WordPress API] Full URL: {}", url);

        let mut query_params: HashMap<String, String> = HashMap::new();

        if let Some(cats) = categories {
            query_params.insert("categories".to_string(), cats.to_string());
            debug!("[WordPress API] Filtering by categories: {}", cats);
        }

        if let Some(pp) = per_page {
            query_params.insert("per_page".to_string(), pp.to_string());
            debug!("[WordPress API] Posts per page: {}", pp);
        }

        if let Some(p) = page {
            query_params.insert("page".to_string(), p.to_string());
            debug!("[WordPress API] Page number: {}", p);
        }

        debug!("[WordPress API] Sending GET request");
        nrc_get(url)
            .query(&query_params)
            .json::<Vec<BlogPost>>("WordPress blog posts")
            .await
    }

    /// Fetches news posts (category 21) and changelog posts (category 2)
    ///
    /// # Returns
    ///
    /// * `Result<Vec<BlogPost>>` - A vector of blog posts or an error
    pub async fn get_news_and_changelogs() -> Result<Vec<BlogPost>> {
        info!("[WordPress API] Fetching news and changelog posts");
        Self::get_blog_posts(Some("21,2"), Some(10), Some(1)).await
    }

    /// Fetches only news posts (category 21)
    ///
    /// # Returns
    ///
    /// * `Result<Vec<BlogPost>>` - A vector of blog posts or an error
    pub async fn get_news() -> Result<Vec<BlogPost>> {
        info!("[WordPress API] Fetching news posts");
        Self::get_blog_posts(Some("21"), Some(10), Some(1)).await
    }

    /// Fetches only changelog posts (category 2)
    ///
    /// # Returns
    ///
    /// * `Result<Vec<BlogPost>>` - A vector of blog posts or an error
    pub async fn get_changelogs() -> Result<Vec<BlogPost>> {
        info!("[WordPress API] Fetching changelog posts");
        Self::get_blog_posts(Some("2"), Some(10), Some(1)).await
    }
}
