export interface WeixinSearchResult {
    /** Article title */
    title: string;
    /** Sogou redirect link (relative links are resolved against weixin.sogou.com) */
    link: string;
    /** Real article URL on mp.weixin.qq.com, empty string if resolution failed */
    real_url: string;
    /** Publish time text as shown on the search result page */
    publish_time: string;
    /** Page number this result came from (stringified for parity with the Python version) */
    page: string;
}
