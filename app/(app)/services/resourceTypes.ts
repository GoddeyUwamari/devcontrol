// The Type filter's options: 'all', then the inventoried resource types.
export const RESOURCE_TYPE_CHIPS = [
  'all',
  'ec2', 'ebs', 'ecs', 'lambda', 'rds', 's3', 'eks', 'dynamodb',
  'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  'load-balancer', 'vpc',
]

// Display names of the inventoried resource types.
export const TYPE_DISPLAY: Record<string, string> = {
  'all': 'All Types', 'ec2': 'EC2', 'ebs': 'EBS', 'ecs': 'ECS', 'lambda': 'Lambda',
  'rds': 'RDS', 's3': 'S3', 'eks': 'EKS', 'dynamodb': 'DynamoDB',
  'cloudfront': 'CloudFront', 'api-gateway': 'API Gateway',
  'elasticache': 'ElastiCache', 'aurora': 'Aurora', 'sqs': 'SQS',
  'sns': 'SNS', 'load-balancer': 'Load Balancer', 'vpc': 'VPC',
}
