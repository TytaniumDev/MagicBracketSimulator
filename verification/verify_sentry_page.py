from playwright.sync_api import sync_playwright

def verify_sentry_page():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            print("Navigating to http://localhost:5173/sentry-example-page...")
            page.goto("http://localhost:5173/sentry-example-page")

            # Wait for the main heading
            page.wait_for_selector("text=Sentry Example Page")
            print("Page loaded.")

            # Check buttons exist
            if not page.is_visible("text=Throw Client Error"):
                print("Client Error button not visible")
            if not page.is_visible("text=Throw Server Error"):
                print("Server Error button not visible")

            # Take screenshot of the page
            screenshot_path = "verification/sentry_page.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_sentry_page()
