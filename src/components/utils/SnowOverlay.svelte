<script>

</script>

<div class="main">
	<div class="initial-snow">
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
		<div class="snow">❄</div>
	</div>
</div>

<style>
    .main {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        animation: main-loadup 1s forwards linear, main-loadup-bg 10s forwards linear;
        animation-delay: 7s, 8s;
    }

    @keyframes main-loadup-bg {
        from {
            background-size: 100% 100%;
            background-position: 0% 0%;
        }

        to {
            background-size: 400% 400%;
            background-position: 0% 100%;
        }
    }

    .initial-snow {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .initial-snow > * {
        font-size: 20px;
        color: white;
        text-shadow: 1.5px 1.5px rgba(0, 0, 0, 0.75);
        position: absolute;
        top: -5vh;
    }

    @keyframes snowfall {
        0% {
            transform: translate3d(var(--left-ini), 0, 0);
            opacity: 0;
        }

        5% {
            opacity: 1;
        }

        100% {
            transform: translate3d(var(--left-end), 110vh, 0);
        }
    }

    .snow:nth-child(2n) {
        filter: blur(1px);
        font-size: 20px;
    }

    .snow:nth-child(6n) {
        filter: blur(1px);
        font-size: 15px;
    }

    .snow:nth-child(10n) {
        filter: blur(1px);
        font-size: 20px;
    }

    .snow:nth-child(1) {
        --size: 0.8vw;
        --left-ini: 0vw;
        --left-end: -1vw;
        left: 70vw;
        animation: snowfall 9s linear infinite;
        animation-delay: -1s;
    }

    .snow:nth-child(2) {
        --size: 0.2vw;
        --left-ini: -7vw;
        --left-end: 10vw;
        left: 65vw;
        animation: snowfall 15s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(3) {
        --size: 1vw;
        --left-ini: 6vw;
        --left-end: 6vw;
        left: 1vw;
        animation: snowfall 9s linear infinite;
        animation-delay: -7s;
    }

    .snow:nth-child(4) {
        --size: 0.2vw;
        --left-ini: -3vw;
        --left-end: 9vw;
        left: 88vw;
        animation: snowfall 14s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(5) {
        --size: 0.4vw;
        --left-ini: -2vw;
        --left-end: -9vw;
        left: 74vw;
        animation: snowfall 6s linear infinite;
        animation-delay: -4s;
    }

    .snow:nth-child(6) {
        --size: 0.2vw;
        --left-ini: 5vw;
        --left-end: 1vw;
        left: 35vw;
        animation: snowfall 6s linear infinite;
        animation-delay: -7s;
    }

    .snow:nth-child(7) {
        --size: 0.4vw;
        --left-ini: -2vw;
        --left-end: -1vw;
        left: 27vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(8) {
        --size: 1vw;
        --left-ini: -9vw;
        --left-end: -2vw;
        left: 69vw;
        animation: snowfall 8s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(9) {
        --size: 0.2vw;
        --left-ini: -1vw;
        --left-end: -5vw;
        left: 84vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(10) {
        --size: 0.2vw;
        --left-ini: 7vw;
        --left-end: -9vw;
        left: 82vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -3s;
    }

    .snow:nth-child(11) {
        --size: 0.6vw;
        --left-ini: -2vw;
        --left-end: -1vw;
        left: 48vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -1s;
    }

    .snow:nth-child(12) {
        --size: 0.2vw;
        --left-ini: 5vw;
        --left-end: 6vw;
        left: 39vw;
        animation: snowfall 15s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(13) {
        --size: 0.2vw;
        --left-ini: 6vw;
        --left-end: 5vw;
        left: 3vw;
        animation: snowfall 9s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(14) {
        --size: 0.8vw;
        --left-ini: -5vw;
        --left-end: -2vw;
        left: 49vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(15) {
        --size: 0.6vw;
        --left-ini: 10vw;
        --left-end: 4vw;
        left: 77vw;
        animation: snowfall 7s linear infinite;
        animation-delay: -4s;
    }

    .snow:nth-child(16) {
        --size: 0.8vw;
        --left-ini: -3vw;
        --left-end: 1vw;
        left: 86vw;
        animation: snowfall 14s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(17) {
        --size: 1vw;
        --left-ini: 6vw;
        --left-end: -7vw;
        left: 18vw;
        animation: snowfall 9s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(18) {
        --size: 1vw;
        --left-ini: -9vw;
        --left-end: 4vw;
        left: 64vw;
        animation: snowfall 13s linear infinite;
        animation-delay: -7s;
    }

    .snow:nth-child(19) {
        --size: 1vw;
        --left-ini: 2vw;
        --left-end: -7vw;
        left: 52vw;
        animation: snowfall 15s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(20) {
        --size: 0.4vw;
        --left-ini: 0vw;
        --left-end: 8vw;
        left: 5vw;
        animation: snowfall 8s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(21) {
        --size: 0.6vw;
        --left-ini: -9vw;
        --left-end: -2vw;
        left: 10vw;
        animation: snowfall 12s linear infinite;
        animation-delay: -3s;
    }

    .snow:nth-child(22) {
        --size: 0.8vw;
        --left-ini: -3vw;
        --left-end: -8vw;
        left: 54vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(23) {
        --size: 0.6vw;
        --left-ini: -7vw;
        --left-end: -8vw;
        left: 20vw;
        animation: snowfall 6s linear infinite;
        animation-delay: -3s;
    }

    .snow:nth-child(24) {
        --size: 0.4vw;
        --left-ini: 10vw;
        --left-end: -4vw;
        left: 68vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -8s;
    }

    .snow:nth-child(25) {
        --size: 1vw;
        --left-ini: 3vw;
        --left-end: 5vw;
        left: 90vw;
        animation: snowfall 7s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(26) {
        --size: 1vw;
        --left-ini: -7vw;
        --left-end: 5vw;
        left: 71vw;
        animation: snowfall 13s linear infinite;
        animation-delay: -2s;
    }

    .snow:nth-child(27) {
        --size: 0.6vw;
        --left-ini: 9vw;
        --left-end: 4vw;
        left: 2vw;
        animation: snowfall 15s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(28) {
        --size: 1vw;
        --left-ini: -5vw;
        --left-end: 3vw;
        left: 23vw;
        animation: snowfall 12s linear infinite;
        animation-delay: -1s;
    }

    .snow:nth-child(29) {
        --size: 0.4vw;
        --left-ini: -2vw;
        --left-end: -1vw;
        left: 39vw;
        animation: snowfall 14s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(30) {
        --size: 0.6vw;
        --left-ini: -9vw;
        --left-end: -5vw;
        left: 76vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(31) {
        --size: 0.4vw;
        --left-ini: -5vw;
        --left-end: 3vw;
        left: 14vw;
        animation: snowfall 8s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(32) {
        --size: 0.2vw;
        --left-ini: 5vw;
        --left-end: -1vw;
        left: 86vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(33) {
        --size: 0.4vw;
        --left-ini: -3vw;
        --left-end: 10vw;
        left: 66vw;
        animation: snowfall 6s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(34) {
        --size: 1vw;
        --left-ini: -3vw;
        --left-end: 6vw;
        left: 75vw;
        animation: snowfall 14s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(35) {
        --size: 1vw;
        --left-ini: -6vw;
        --left-end: 7vw;
        left: 22vw;
        animation: snowfall 7s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(36) {
        --size: 1vw;
        --left-ini: 3vw;
        --left-end: 4vw;
        left: 10vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -10s;
    }

    .snow:nth-child(37) {
        --size: 0.6vw;
        --left-ini: 2vw;
        --left-end: 10vw;
        left: 95vw;
        animation: snowfall 13s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(38) {
        --size: 0.8vw;
        --left-ini: 5vw;
        --left-end: 8vw;
        left: 34vw;
        animation: snowfall 9s linear infinite;
        animation-delay: -10s;
    }

    .snow:nth-child(39) {
        --size: 0.8vw;
        --left-ini: 4vw;
        --left-end: 0vw;
        left: 80vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -2s;
    }

    .snow:nth-child(40) {
        --size: 0.8vw;
        --left-ini: 1vw;
        --left-end: -7vw;
        left: 45vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -4s;
    }

    .snow:nth-child(41) {
        --size: 0.2vw;
        --left-ini: 9vw;
        --left-end: 10vw;
        left: 82vw;
        animation: snowfall 8s linear infinite;
        animation-delay: -2s;
    }

    .snow:nth-child(42) {
        --size: 1vw;
        --left-ini: 9vw;
        --left-end: -9vw;
        left: 22vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(43) {
        --size: 0.6vw;
        --left-ini: 5vw;
        --left-end: 8vw;
        left: 66vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -1s;
    }

    .snow:nth-child(44) {
        --size: 0.6vw;
        --left-ini: -5vw;
        --left-end: -2vw;
        left: 75vw;
        animation: snowfall 12s linear infinite;
        animation-delay: -4s;
    }

    .snow:nth-child(45) {
        --size: 0.2vw;
        --left-ini: 0vw;
        --left-end: 3vw;
        left: 2vw;
        animation: snowfall 7s linear infinite;
        animation-delay: -5s;
    }

    .snow:nth-child(46) {
        --size: 0.2vw;
        --left-ini: 8vw;
        --left-end: -3vw;
        left: 94vw;
        animation: snowfall 8s linear infinite;
        animation-delay: -9s;
    }

    .snow:nth-child(47) {
        --size: 0.6vw;
        --left-ini: -6vw;
        --left-end: -9vw;
        left: 95vw;
        animation: snowfall 11s linear infinite;
        animation-delay: -4s;
    }

    .snow:nth-child(48) {
        --size: 0.2vw;
        --left-ini: -5vw;
        --left-end: 6vw;
        left: 34vw;
        animation: snowfall 10s linear infinite;
        animation-delay: -6s;
    }

    .snow:nth-child(49) {
        --size: 0.8vw;
        --left-ini: 4vw;
        --left-end: 8vw;
        left: 22vw;
        animation: snowfall 12s linear infinite;
        animation-delay: -10s;
    }

    .snow:nth-child(50) {
        --size: 0.2vw;
        --left-ini: -4vw;
        --left-end: 4vw;
        left: 100vw;
        animation: snowfall 14s linear infinite;
        animation-delay: -9s;
    }
</style>