'use client';
/* eslint-disable @next/next/no-img-element */

import {
	Children,
	isValidElement,
	type MouseEvent,
	type ReactNode,
	type SubmitEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type Hls from 'hls.js';
import {
	type RedditCommentNode,
	type RedditMediaItem,
	type RedditViewerResponse,
	formatDate,
	formatRelative,
	formatScore,
} from './lib/reddit';

const EXTENSION_REQUEST_TYPE = 'LIMEN_FETCH_REDDIT';
const EXTENSION_RESPONSE_TYPE = 'LIMEN_FETCH_REDDIT_RESULT';
const EXTENSION_TIMEOUT_MS = 20_000;

type ExtensionSuccessResponse = {
	type: typeof EXTENSION_RESPONSE_TYPE;
	requestId: string;
	ok: true;
	payload: RedditViewerResponse;
};

type ExtensionErrorResponse = {
	type: typeof EXTENSION_RESPONSE_TYPE;
	requestId: string;
	ok: false;
	error?: string;
};

type ExtensionBridgeResponse = ExtensionSuccessResponse | ExtensionErrorResponse;

function isBridgeResponse(value: unknown, requestId: string): value is ExtensionBridgeResponse {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.type === EXTENSION_RESPONSE_TYPE &&
		candidate.requestId === requestId &&
		typeof candidate.ok === 'boolean'
	);
}

function fetchRedditViaExtension(url: string): Promise<RedditViewerResponse> {
	const requestId = `limen-${crypto.randomUUID()}`;

	return new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			window.removeEventListener('message', handleMessage);
			reject(
				new Error(
					'Limen extension did not respond. Reload the extension and this page, then try again.'
				)
			);
		}, EXTENSION_TIMEOUT_MS);

		function cleanup() {
			window.clearTimeout(timeoutId);
			window.removeEventListener('message', handleMessage);
		}

		function handleMessage(event: MessageEvent) {
			if (event.source !== window) return;
			if (!isBridgeResponse(event.data, requestId)) return;

			cleanup();

			if (event.data.ok) {
				resolve(event.data.payload);
				return;
			}

			reject(new Error(event.data.error ?? 'Unable to load this post via extension.'));
		}

		window.addEventListener('message', handleMessage);
		window.postMessage({ type: EXTENSION_REQUEST_TYPE, requestId, url }, window.location.origin);
	});
}

function countReplies(node: RedditCommentNode): number {
	let count = node.replies.length;
	for (const reply of node.replies) count += countReplies(reply);
	return count;
}

function isSameAuthor(authorA: string, authorB: string): boolean {
	return authorA.trim().toLowerCase() === authorB.trim().toLowerCase();
}

function stopPropagation(event: MouseEvent<HTMLElement>) {
	event.stopPropagation();
}

function getSafeHttpUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return url;
		}
	} catch {
		// invalid or unsupported URL
	}

	return null;
}

function getMediaKindFromUrl(value: string): 'image' | 'video' | null {
	const url = getSafeHttpUrl(value);
	if (!url) return null;

	const pathname = url.pathname.toLowerCase();
	const extension = pathname.split('.').pop() ?? '';
	const format = url.searchParams.get('format')?.toLowerCase() ?? '';

	if (
		['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'].includes(extension) ||
		['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'].includes(format)
	) {
		return 'image';
	}

	if (
		['mp4', 'webm', 'mov', 'm4v', 'gifv'].includes(extension) ||
		['mp4', 'webm'].includes(format)
	) {
		return 'video';
	}

	return null;
}

function getNodeText(node: ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(getNodeText).join('');
	}

	if (isValidElement<{ children?: ReactNode }>(node)) {
		return getNodeText(node.props.children);
	}

	return '';
}

function getStandaloneMediaUrl(children: ReactNode): string | null {
	const meaningfulChildren = Children.toArray(children).filter(
		(child) => !(typeof child === 'string' && child.trim() === '')
	);

	if (meaningfulChildren.length !== 1) {
		return null;
	}

	const child = meaningfulChildren[0];
	if (!isValidElement<{ href?: string; children?: ReactNode }>(child) || child.type !== 'a') {
		return null;
	}

	const href = typeof child.props.href === 'string' ? child.props.href : '';
	if (!href || getNodeText(child.props.children).trim() !== href) {
		return null;
	}

	return getMediaKindFromUrl(href) ? href : null;
}

function MarkdownMedia({ href }: { href: string }) {
	const mediaKind = getMediaKindFromUrl(href);
	if (!mediaKind) {
		return null;
	}

	const safeUrl = getSafeHttpUrl(href);
	if (!safeUrl) {
		return null;
	}

	if (mediaKind === 'image') {
		return (
			<div className='markdown-media' onClick={stopPropagation} onDoubleClick={stopPropagation}>
				<img src={safeUrl.toString()} alt='' loading='lazy' />
			</div>
		);
	}

	return (
		<div className='markdown-media' onClick={stopPropagation} onDoubleClick={stopPropagation}>
			<video src={safeUrl.toString()} controls preload='metadata' playsInline />
		</div>
	);
}

function MarkdownText({ markdown, className }: { markdown: string; className: string }) {
	return (
		<div className={className}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: ({ children, ...props }) => {
						const mediaUrl = getStandaloneMediaUrl(children);
						if (mediaUrl) {
							return <MarkdownMedia href={mediaUrl} />;
						}

						return <p {...props}>{children}</p>;
					},
					a: ({ onClick, onDoubleClick, ...props }) => (
						<a
							{...props}
							target='_blank'
							rel='noopener noreferrer'
							onClick={(event) => {
								event.stopPropagation();
								onClick?.(event);
							}}
							onDoubleClick={(event) => {
								event.stopPropagation();
								onDoubleClick?.(event);
							}}
						/>
					),
					img: ({ alt, onClick, onDoubleClick, ...props }) => (
						<img
							{...props}
							alt={alt ?? ''}
							loading='lazy'
							onClick={(event) => {
								event.stopPropagation();
								onClick?.(event);
							}}
							onDoubleClick={(event) => {
								event.stopPropagation();
								onDoubleClick?.(event);
							}}
						/>
					),
				}}>
				{markdown}
			</ReactMarkdown>
		</div>
	);
}

function RedditVideo({ item }: { item: Extract<RedditMediaItem, { kind: 'video' }> }) {
	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		let hlsInstance: Hls | null = null;
		let canceled = false;

		video.defaultMuted = false;
		video.muted = false;

		const setFallbackSource = () => {
			if (video.src !== item.url) {
				video.src = item.url;
				video.load();
			}
		};

		if (!item.hlsUrl) {
			setFallbackSource();
			return;
		}

		const nativeHlsSupport = video.canPlayType('application/vnd.apple.mpegurl');
		if (nativeHlsSupport) {
			video.src = item.hlsUrl;
			return;
		}

		void (async () => {
			try {
				const { default: Hls } = await import('hls.js');
				if (canceled) return;

				if (!Hls.isSupported()) {
					setFallbackSource();
					return;
				}

				hlsInstance = new Hls();
				hlsInstance.loadSource(item.hlsUrl!);
				hlsInstance.attachMedia(video);

				hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
					if (data?.fatal) {
						hlsInstance?.destroy();
						hlsInstance = null;
						setFallbackSource();
					}
				});
			} catch {
				setFallbackSource();
			}
		})();

		return () => {
			canceled = true;
			hlsInstance?.destroy();
		};
	}, [item.hlsUrl, item.url]);

	return <video ref={videoRef} controls preload='metadata' playsInline />;
}

function CommentTree({
	node,
	depth = 0,
	opAuthor,
}: {
	node: RedditCommentNode;
	depth?: number;
	opAuthor: string;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const isOpComment = isSameAuthor(node.author, opAuthor);

	return (
		<div
			className={`comment ${isOpComment ? 'comment-op' : ''} ${collapsed ? 'comment-collapsed' : ''}`}
			style={{ marginLeft: `${depth * 16}px` }}
			onClick={(e) => {
				e.stopPropagation();
				setCollapsed((c) => !c);
			}}>
			<div className='comment-meta'>
				<span className='comment-author'>u/{node.author}</span>
				{isOpComment && <span className='comment-op-badge'>OP</span>}
				<span className='comment-score'>{formatScore(node.score)} points</span>
				<span className='comment-time'>{formatRelative(node.createdUtc)}</span>
				{collapsed && node.replies.length > 0 && (
					<span className='comment-collapsed-count'>
						+{countReplies(node)} {countReplies(node) === 1 ? 'reply' : 'replies'}
					</span>
				)}
			</div>
			{!collapsed && (
				<>
					<MarkdownText markdown={node.body} className='comment-body markdown-content' />
					{node.replies.length > 0 && (
						<div className='comment-replies'>
							{node.replies.map((reply) => (
								<CommentTree
									key={`${node.id}-${reply.id}`}
									node={reply}
									depth={depth + 1}
									opAuthor={opAuthor}
								/>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default function Home() {
	const [url, setUrl] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [data, setData] = useState<RedditViewerResponse | null>(null);
	const hasAutoOpenedRef = useRef(false);
	const postTitle = data?.post.title?.trim();

	const sourceHost = useMemo(() => {
		if (!data?.post.url) return null;
		try {
			return new URL(data.post.url).hostname;
		} catch {
			return null;
		}
	}, [data]);

	const loadPost = useCallback(async (rawUrl: string) => {
		const trimmedUrl = rawUrl.trim();
		if (!trimmedUrl) {
			setError('Please paste a Reddit post URL.');
			return;
		}

		setIsLoading(true);
		setError('');

		try {
			const payload = await fetchRedditViaExtension(trimmedUrl);
			setData(payload);
		} catch (submitError) {
			setData(null);
			setError(
				submitError instanceof Error
					? submitError.message
					: 'Something went wrong while opening that link.'
			);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (hasAutoOpenedRef.current) {
			return;
		}

		hasAutoOpenedRef.current = true;
		const incomingUrl = new URLSearchParams(window.location.search).get('url');
		if (!incomingUrl?.trim()) {
			return;
		}

		setUrl(incomingUrl);
		void loadPost(incomingUrl);
	}, [loadPost]);

	useEffect(() => {
		document.title = postTitle && postTitle.length > 0 ? postTitle : 'Limen';
	}, [postTitle]);

	async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		void loadPost(url);
	}

	return (
		<div className='page'>
			<div className='top-rule' />

			<div className='wrapper'>
				<header className='masthead'>
					<h1 className='masthead-title'>Limen</h1>
					<hr className='masthead-rule' />
				</header>

				<div className='input-section'>
					<label htmlFor='url' className='input-label'>
						Post URL
					</label>
					<form onSubmit={handleSubmit} className='form'>
						<input
							id='url'
							type='url'
							inputMode='url'
							autoComplete='off'
							className='url-input'
							placeholder='https://www.reddit.com/r/.../comments/...'
							value={url}
							onChange={(e) => setUrl(e.target.value)}
						/>
						<button type='submit' className='submit-btn' disabled={isLoading}>
							{isLoading ? 'Opening\u2026' : 'Open Post'}
						</button>
					</form>
					{error && <p className='error'>{error}</p>}
				</div>

				{isLoading && <p className='loading'>Fetching post\u2026</p>}

				{data && (
					<article className='article' aria-live='polite'>
						<div className='flex justify-between pt-4'>
							<p>
								By <span className='byline-author'>u/{data.post.author}</span> in{' '}
								<span className='byline-author'>r/{data.post.subreddit}</span>
							</p>
							<p className='post-dateline'>
								{formatDate(data.post.createdUtc)} &mdash;&mdash;{' '}
								{formatRelative(data.post.createdUtc)}
							</p>
						</div>

						<h2 className='post-title pt-4'>{data.post.title}</h2>

						<MarkdownText markdown={data.post.selftext} className='body-text markdown-content' />
						<div className='stats py-4'>
							<span className='stat-item'>{formatScore(data.post.score)} upvotes</span>
							<span className='stat-sep'>&middot;</span>
							<span className='stat-item'>{formatScore(data.post.numComments)} comments</span>
							{typeof data.post.upvoteRatio === 'number' && (
								<>
									<span className='stat-sep'>&middot;</span>
									<span className='stat-item'>
										{Math.round(data.post.upvoteRatio * 100)}% upvotes
									</span>
								</>
							)}
						</div>

						{data.post.media.length > 0 && (
							<>
								<h3 className='section-header'>Media</h3>
								<hr className='section-rule' />
								<div className='media-grid'>
									{data.post.media.map((item, index) =>
										item.kind === 'image' ? (
											<figure key={`${item.url}-${index}`} style={{ margin: 0 }}>
												<img
													src={item.url}
													alt={item.caption ?? `Media ${index + 1}`}
													loading='lazy'
												/>
												{item.caption && (
													<figcaption className='media-caption'>{item.caption}</figcaption>
												)}
											</figure>
										) : (
											<RedditVideo key={`${item.url}-${index}`} item={item} />
										)
									)}
								</div>
							</>
						)}

						{!data.post.selftext.trim() && data.post.url && (
							<>
								<h3 className='section-header'>Linked URL</h3>
								<hr className='section-rule' />
								<p className='linked-url'>
									<a
										href={data.post.url}
										target='_blank'
										rel='noopener noreferrer'
										onClick={stopPropagation}
										onDoubleClick={stopPropagation}>
										{data.post.url}
									</a>
								</p>
								{sourceHost && <p className='source-domain'>Source domain: {sourceHost}</p>}
							</>
						)}

						<hr className='section-rule' />
						{data.comments.length > 0 ? (
							<div className='comments-list'>
								{data.comments.map((comment) => (
									<CommentTree key={comment.id} node={comment} opAuthor={data.post.author} />
								))}
							</div>
						) : (
							<p className='no-comments'>No comments were returned for this post.</p>
						)}

						<footer className='footer'>
							<p className='footer-text'>
								Canonical URL:{' '}
								<a
									href={data.canonicalUrl}
									target='_blank'
									rel='noopener noreferrer'
									onClick={stopPropagation}
									onDoubleClick={stopPropagation}>
									{data.canonicalUrl}
								</a>
							</p>
							<p className='footer-text'>
								Loaded at: {formatDate(Date.parse(data.fetchedAt) / 1000)}
							</p>
						</footer>
					</article>
				)}
			</div>
		</div>
	);
}
