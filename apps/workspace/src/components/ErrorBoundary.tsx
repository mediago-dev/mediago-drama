import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import React from "react";
import { Button } from "@/shared/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/shared/components/ui/card";

interface ErrorBoundaryState {
	hasError: boolean;
	error?: Error;
	errorId?: string;
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
	onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

class ErrorBoundaryClass extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		// 生成错误 ID
		const errorId = Math.random().toString(36).substring(2, 15);
		return {
			hasError: true,
			error,
			errorId,
		};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		// 调用自定义错误处理
		this.props.onError?.(error, errorInfo);

		// 开发环境下打印详细错误信息
		console.group("🚨 ErrorBoundary caught an error");
		console.error("Error:", error);
		console.error("Component Stack:", errorInfo.componentStack);
		console.groupEnd();
	}

	handleReset = () => {
		this.setState({ hasError: false, error: undefined, errorId: undefined });
	};

	render() {
		if (this.state.hasError) {
			// 如果提供了自定义 fallback 组件
			if (this.props.fallback) {
				const FallbackComponent = this.props.fallback;
				return <FallbackComponent error={this.state.error} resetError={this.handleReset} />;
			}

			// 默认错误 UI
			return (
				<DefaultErrorFallback
					error={this.state.error}
					resetError={this.handleReset}
					errorId={this.state.errorId}
				/>
			);
		}

		return this.props.children;
	}
}

// 默认错误回退组件
const DefaultErrorFallback: React.FC<{
	error?: Error;
	resetError: () => void;
	errorId?: string;
}> = ({ error, resetError, errorId }) => {
	const isDev = !import.meta.env.PROD;

	return (
		<div className="flex min-h-screen items-center justify-center bg-ide-editor px-6 py-10 text-ide-editor-foreground">
			<Card className="w-full max-w-3xl border-destructive/20 shadow-overlay">
				<CardHeader className="gap-4">
					<div className="flex h-14 w-14 items-center justify-center rounded-sm bg-destructive/10 text-destructive">
						<AlertTriangle className="h-6 w-6" />
					</div>
					<div className="space-y-2">
						<CardTitle className="text-2xl">应用程序遇到了一个错误</CardTitle>
						<CardDescription className="max-w-2xl text-base">
							很抱歉，应用程序遇到了一个意外错误。问题已经被本地错误边界捕获，你可以重试或返回首页。
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{errorId ? (
						<div className="rounded-sm border border-border/70 bg-ide-editor px-4 py-3 text-sm">
							<span className="text-muted-foreground">错误 ID：</span>
							<code className="font-mono text-foreground">{errorId}</code>
						</div>
					) : null}

					{isDev && error ? (
						<div className="space-y-3">
							<p className="text-sm font-medium text-destructive">开发模式错误详情</p>
							<pre className="max-h-80 overflow-auto rounded-sm border border-border/70 bg-ide-editor p-4 font-mono text-xs leading-6 text-muted-foreground">
								{error.message}
								{error.stack ? `\n\n调用栈：\n${error.stack}` : ""}
							</pre>
						</div>
					) : null}

					<div className="flex flex-wrap gap-3">
						<Button onClick={resetError}>
							<RotateCcw />
							重新加载
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								window.location.href = "/";
							}}
						>
							<Home />
							返回首页
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ children, ...props }) => {
	return <ErrorBoundaryClass {...props}>{children}</ErrorBoundaryClass>;
};

// HOC 版本的 ErrorBoundary
export const withErrorBoundary = <P extends object>(
	Component: React.ComponentType<P>,
	fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>,
) => {
	const WrappedComponent = (props: P) => (
		<ErrorBoundary fallback={fallback}>
			<Component {...props} />
		</ErrorBoundary>
	);

	WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
	return WrappedComponent;
};

export default ErrorBoundary;
