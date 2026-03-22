/**
 * Static compliance control library — SOC 2 Type II + HIPAA Security Rule
 * Controls are evaluated against existing aws_resources DB data.
 */

export type ControlSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ControlFramework = 'soc2' | 'hipaa';
export type ControlStatus = 'pass' | 'fail' | 'not_applicable';

export interface ControlEvidence {
  totalResources?: number;
  passingCount?: number;
  failingCount?: number;
  details?: string;
}

export interface ComplianceControl {
  id: string;
  framework: ControlFramework;
  controlId: string;
  category: string;
  name: string;
  description: string;
  severity: ControlSeverity;
  remediationGuidance: string;
}

export const SOC2_CONTROLS: ComplianceControl[] = [
  {
    id: 'soc2-cc1-1',
    framework: 'soc2',
    controlId: 'CC1.1',
    category: 'Control Environment',
    name: 'Integrity and Ethics',
    description: 'The organization has established standards of conduct and enforces accountability for infrastructure-level security policies.',
    severity: 'high',
    remediationGuidance: 'Ensure all AWS resources have required tags including owner, team, and environment for accountability tracing.',
  },
  {
    id: 'soc2-cc2-1',
    framework: 'soc2',
    controlId: 'CC2.1',
    category: 'Communication',
    name: 'Internal Communication',
    description: 'Security alerts, anomalies, and compliance issues are communicated internally to relevant personnel.',
    severity: 'medium',
    remediationGuidance: 'Configure alerting and anomaly detection. Ensure all detected anomalies are reviewed and acknowledged.',
  },
  {
    id: 'soc2-cc3-1',
    framework: 'soc2',
    controlId: 'CC3.1',
    category: 'Risk Assessment',
    name: 'Risk Assessment Process',
    description: 'The organization identifies and assesses risks to the achievement of its objectives.',
    severity: 'high',
    remediationGuidance: 'Run regular compliance scans and ensure all high-severity compliance issues are tracked and remediated.',
  },
  {
    id: 'soc2-cc6-1',
    framework: 'soc2',
    controlId: 'CC6.1',
    category: 'Logical Access',
    name: 'Encryption at Rest',
    description: 'Logical access security software, infrastructure, and architectures are implemented to protect against threats. All data at rest must be encrypted.',
    severity: 'critical',
    remediationGuidance: 'Enable encryption at rest for all EBS volumes, RDS instances, and S3 buckets. Use AWS KMS for key management.',
  },
  {
    id: 'soc2-cc6-2',
    framework: 'soc2',
    controlId: 'CC6.2',
    category: 'Logical Access',
    name: 'Authentication Controls',
    description: 'New internal and external system users are registered and authorized. Access credentials are managed securely.',
    severity: 'high',
    remediationGuidance: 'Enforce MFA on all IAM users and roles. Rotate access keys regularly. Remove unused IAM credentials.',
  },
  {
    id: 'soc2-cc6-3',
    framework: 'soc2',
    controlId: 'CC6.3',
    category: 'Logical Access',
    name: 'Privileged Access Management',
    description: 'Role-based access control mechanisms are in place to limit privileged access to infrastructure resources.',
    severity: 'critical',
    remediationGuidance: 'Apply principle of least privilege. Review and remove overly permissive IAM policies. Use resource-based policies where appropriate.',
  },
  {
    id: 'soc2-cc6-6',
    framework: 'soc2',
    controlId: 'CC6.6',
    category: 'Network Security',
    name: 'Public Network Exposure',
    description: 'Logical access to information assets and boundaries is restricted from unauthorized external access.',
    severity: 'critical',
    remediationGuidance: 'Remove public access from S3 buckets, RDS instances, and EC2 instances unless explicitly required. Use VPC and security groups.',
  },
  {
    id: 'soc2-cc6-7',
    framework: 'soc2',
    controlId: 'CC6.7',
    category: 'Transmission Security',
    name: 'Data Transmission Encryption',
    description: 'Restricted information is transmitted using encryption and secure protocols.',
    severity: 'high',
    remediationGuidance: 'Enforce TLS 1.2+ on all load balancers and API endpoints. Disable HTTP-only listeners. Enforce SSL on RDS connections.',
  },
  {
    id: 'soc2-cc7-1',
    framework: 'soc2',
    controlId: 'CC7.1',
    category: 'System Monitoring',
    name: 'Security Monitoring',
    description: 'The entity detects and monitors for vulnerabilities, threats, and security events across infrastructure.',
    severity: 'high',
    remediationGuidance: 'Enable CloudTrail, GuardDuty, and Config across all AWS accounts and regions. Ensure logs are retained for at least 90 days.',
  },
  {
    id: 'soc2-cc7-2',
    framework: 'soc2',
    controlId: 'CC7.2',
    category: 'System Monitoring',
    name: 'Anomaly Detection',
    description: 'Security incidents and anomalies are detected and assessed.',
    severity: 'high',
    remediationGuidance: 'Maintain active anomaly detection. All CRITICAL and HIGH anomalies must be acknowledged or resolved within 24 hours.',
  },
  {
    id: 'soc2-cc9-1',
    framework: 'soc2',
    controlId: 'CC9.1',
    category: 'Business Continuity',
    name: 'Data Backup and Recovery',
    description: 'The entity identifies, develops, and implements activities to recover from infrastructure disruptions.',
    severity: 'high',
    remediationGuidance: 'Enable automated backups for all RDS instances, EBS volumes, and critical data stores. Test recovery procedures quarterly.',
  },
  {
    id: 'soc2-a1-1',
    framework: 'soc2',
    controlId: 'A1.1',
    category: 'Availability',
    name: 'Infrastructure Capacity and Performance',
    description: 'Current processing capacity and usage are maintained and monitored to manage capacity demands.',
    severity: 'medium',
    remediationGuidance: 'Monitor CPU, memory, and disk utilization. Set up auto-scaling and ensure no resources are running at critical capacity for extended periods.',
  },
];

export const HIPAA_CONTROLS: ComplianceControl[] = [
  {
    id: 'hipaa-308-a-1',
    framework: 'hipaa',
    controlId: '§164.308(a)(1)',
    category: 'Administrative Safeguards',
    name: 'Risk Analysis',
    description: 'Conduct an accurate and thorough assessment of the potential risks and vulnerabilities to ePHI.',
    severity: 'critical',
    remediationGuidance: 'Run regular compliance scans identifying all high-severity risks. Document risk assessment results and remediation plans.',
  },
  {
    id: 'hipaa-308-a-3',
    framework: 'hipaa',
    controlId: '§164.308(a)(3)',
    category: 'Administrative Safeguards',
    name: 'Workforce Access Management',
    description: 'Implement policies and procedures for authorizing access to ePHI in accordance with minimum necessary access.',
    severity: 'high',
    remediationGuidance: 'Apply minimum necessary access principles to all AWS IAM roles. Remove overly permissive policies. Conduct quarterly access reviews.',
  },
  {
    id: 'hipaa-308-a-5',
    framework: 'hipaa',
    controlId: '§164.308(a)(5)',
    category: 'Administrative Safeguards',
    name: 'Security Awareness',
    description: 'Implement a security awareness and training program for all members of the workforce.',
    severity: 'medium',
    remediationGuidance: 'Ensure security incidents and anomalies are logged, tracked, and communicated. Maintain audit logs of all security events.',
  },
  {
    id: 'hipaa-308-a-8',
    framework: 'hipaa',
    controlId: '§164.308(a)(8)',
    category: 'Administrative Safeguards',
    name: 'Evaluation',
    description: 'Perform a periodic technical and nontechnical evaluation of security safeguards.',
    severity: 'medium',
    remediationGuidance: 'Run quarterly compliance scans. Remediate all critical and high findings. Document evaluation results.',
  },
  {
    id: 'hipaa-312-a-1',
    framework: 'hipaa',
    controlId: '§164.312(a)(1)',
    category: 'Technical Safeguards',
    name: 'Access Control',
    description: 'Implement technical policies and procedures for allowing only authorized persons to access ePHI.',
    severity: 'critical',
    remediationGuidance: 'Restrict access to all data stores to authorized roles only. Remove public access from S3 buckets and RDS instances containing ePHI.',
  },
  {
    id: 'hipaa-312-a-2iv',
    framework: 'hipaa',
    controlId: '§164.312(a)(2)(iv)',
    category: 'Technical Safeguards',
    name: 'Encryption and Decryption',
    description: 'Implement a mechanism to encrypt and decrypt ePHI at rest.',
    severity: 'critical',
    remediationGuidance: 'Enable AES-256 encryption at rest for all storage resources (EBS, RDS, S3, DynamoDB) that may contain ePHI.',
  },
  {
    id: 'hipaa-312-b',
    framework: 'hipaa',
    controlId: '§164.312(b)',
    category: 'Technical Safeguards',
    name: 'Audit Controls',
    description: 'Implement hardware, software, and procedural mechanisms to record and examine activity in systems containing ePHI.',
    severity: 'high',
    remediationGuidance: 'Enable CloudTrail in all regions and accounts. Enable RDS audit logging. Retain logs for minimum 6 years per HIPAA requirements.',
  },
  {
    id: 'hipaa-312-c-1',
    framework: 'hipaa',
    controlId: '§164.312(c)(1)',
    category: 'Technical Safeguards',
    name: 'Integrity Controls',
    description: 'Implement policies and procedures to protect ePHI from improper alteration or destruction.',
    severity: 'high',
    remediationGuidance: 'Enable versioning on S3 buckets. Enable automated backups on RDS and EBS. Use checksums and integrity validation.',
  },
  {
    id: 'hipaa-312-c-2',
    framework: 'hipaa',
    controlId: '§164.312(c)(2)',
    category: 'Technical Safeguards',
    name: 'Transmission Integrity',
    description: 'Implement security measures to ensure that ePHI being transmitted is not improperly modified.',
    severity: 'high',
    remediationGuidance: 'Enforce HTTPS-only access to all endpoints. Disable plain HTTP listeners on load balancers.',
  },
  {
    id: 'hipaa-312-d',
    framework: 'hipaa',
    controlId: '§164.312(d)',
    category: 'Technical Safeguards',
    name: 'Person/Entity Authentication',
    description: 'Implement procedures to verify that a person or entity seeking access to ePHI is the one claimed.',
    severity: 'critical',
    remediationGuidance: 'Enforce MFA on all IAM users with console access. Use IAM Identity Center for centralized authentication. Disable root access keys.',
  },
  {
    id: 'hipaa-312-e-1',
    framework: 'hipaa',
    controlId: '§164.312(e)(1)',
    category: 'Technical Safeguards',
    name: 'Transmission Security',
    description: 'Implement technical security measures to guard against unauthorized access to ePHI being transmitted.',
    severity: 'critical',
    remediationGuidance: 'Enforce TLS 1.2+ on all data transmission paths. Use VPC endpoints for AWS service communication to avoid public internet transit.',
  },
  {
    id: 'hipaa-312-e-2ii',
    framework: 'hipaa',
    controlId: '§164.312(e)(2)(ii)',
    category: 'Technical Safeguards',
    name: 'Transmission Encryption',
    description: 'Implement a mechanism to encrypt ePHI in transit whenever deemed appropriate.',
    severity: 'critical',
    remediationGuidance: 'Enable SSL/TLS for all RDS connections. Configure S3 bucket policies to deny non-HTTPS requests. Use ACM certificates on load balancers.',
  },
];

export const ALL_CONTROLS: ComplianceControl[] = [...SOC2_CONTROLS, ...HIPAA_CONTROLS];

export function getControlsByFramework(framework: ControlFramework): ComplianceControl[] {
  return ALL_CONTROLS.filter((c) => c.framework === framework);
}
