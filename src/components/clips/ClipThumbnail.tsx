"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { saveClipThumbnail, type ClipEntry } from "../../services/clip-service";

const WIDTH = 640;

const AT_SECONDS = 1;

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = queue.then(job, job);
    queue = next.catch(() => {});
    return next;
}

function grabStill(src: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.src = src;
        video.muted = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";

        const fail = (why: string) => {
            cleanup();
            reject(new Error(why));
        };

        const cleanup = () => {
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
            video.src = "";
        };

        const onError = () => fail("the clip could not be decoded");

        const onLoaded = () => {
            const at = Math.min(AT_SECONDS, Math.max(0, video.duration / 2));
            if (!Number.isFinite(at)) return fail("the clip has no length");
            video.currentTime = at;
        };

        const onSeeked = () => {
            const ratio = video.videoHeight / Math.max(1, video.videoWidth);
            const canvas = document.createElement("canvas");
            canvas.width = WIDTH;
            canvas.height = Math.max(1, Math.round(WIDTH * ratio));

            const context = canvas.getContext("2d");
            if (!context) return fail("no canvas context");
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(
                (blob) => {
                    if (!blob) return fail("the still could not be encoded");
                    blob
                        .arrayBuffer()
                        .then((buffer) => {
                            cleanup();
                            resolve(new Uint8Array(buffer));
                        })
                        .catch(() => fail("the still could not be read back"));
                },
                "image/jpeg",
                0.72,
            );
        };

        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
    });
}

interface Props {
    clip: ClipEntry;
    onStored: () => void;
}

export function ClipThumbnail({ clip, onStored }: Props) {
    const [failed, setFailed] = useState(false);
    const asked = useRef(false);

    const stored = clip.thumbnail ? convertFileSrc(clip.thumbnail) : null;

    useEffect(() => {
        if (stored || failed || asked.current) return;
        asked.current = true;

        let alive = true;
        void enqueue(async () => {
            try {
                const jpeg = await grabStill(convertFileSrc(clip.path));
                await saveClipThumbnail(clip.path, jpeg);
                if (alive) onStored();
            } catch (e) {
                console.warn("Could not make a still for", clip.name, e);
                if (alive) setFailed(true);
            }
        });

        return () => {
            alive = false;
        };
    }, [clip.path, clip.name, stored, failed, onStored]);

    if (stored) {
        return (
            <img
                src={stored}
                alt=""
                draggable={false}
                className="aspect-video w-full bg-black object-cover"
            />
        );
    }

    return (
        <div className="flex aspect-video w-full items-center justify-center bg-black">
            <Icon
                icon={failed ? "solar:videocamera-bold" : "svg-spinners:ring-resize"}
                className="h-6 w-6 text-white/20"
            />
        </div>
    );
}
