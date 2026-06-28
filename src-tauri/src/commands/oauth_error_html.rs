pub const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login Failed</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(30, 20, 20, 0.98) 100%);
            color: white;
            padding: 20px;
            position: relative;
            overflow: hidden;
        }

        /* Subtle background pattern */
        body::before {
            content: '';
            position: absolute;
            inset: 0;
            background-image:
                radial-gradient(circle at 20% 50%, rgba(239, 68, 68, 0.05) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(239, 68, 68, 0.05) 0%, transparent 50%);
            pointer-events: none;
        }

        .container {
            position: relative;
            z-index: 1;
            text-align: center;
            padding: 2.5rem 2.5rem 3rem;
            background: rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
            max-width: 480px;
            width: 100%;
            transition: all 0.3s ease;
        }

        .container:hover {
            border-color: rgba(255, 255, 255, 0.15);
            box-shadow:
                0 12px 40px rgba(0, 0, 0, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.15);
        }

        .icon-wrapper {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 50%;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .error-icon {
            width: 48px;
            height: 48px;
            stroke: #ef4444;
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
            fill: none;
        }

        h1 {
            font-size: 1.75rem;
            font-weight: 600;
            color: white;
            margin-bottom: 0.75rem;
            letter-spacing: -0.02em;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }

        .error-message {
            font-size: 0.95rem;
            color: rgba(255, 255, 255, 0.7);
            line-height: 1.6;
            margin-top: 1rem;
            padding: 1rem;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 8px;
            text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
            word-break: break-word;
        }

        .close-hint {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 0.85rem;
            color: rgba(255, 255, 255, 0.5);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .branding {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-bottom: 2rem;
            font-size: 0.85rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.8);
            letter-spacing: 0.08em;
            text-transform: uppercase;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }

        .branding-bolt {
            display: inline-block;
            color: #4f8eff;
            font-size: 1rem;
            filter: drop-shadow(0 0 4px rgba(79, 142, 255, 0.5));
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="branding">
            <span>NORISK</span>
            <span class="branding-bolt">⚡</span>
            <span>CLIENT</span>
        </div>
        <div class="icon-wrapper">
            <svg class="error-icon" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
            </svg>
        </div>
        <h1>Login Failed</h1>
        <p id="error-message" class="error-message">An error occurred during login.</p>
        <p class="close-hint">You can close this window.</p>
    </div>
    <script>
        // Extract error from URL parameters if present
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        const errorDescription = urlParams.get('error_description');

        if (error || errorDescription) {
            const errorMsg = error && errorDescription
                ? `${error}: ${errorDescription}`
                : error || errorDescription || 'An error occurred during login.';
            document.getElementById('error-message').textContent = errorMsg;
        }
    </script>
</body>
</html>"#;
